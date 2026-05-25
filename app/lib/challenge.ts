// [LAW:single-enforcer] The one place that defines, issues, and verifies
// challenge tokens. Both /api/challenge (issuer) and /api/generate (verifier)
// import from here — the logic lives in neither route.
//
// [LAW:types-are-the-program] ChallengeToken is a branded opaque string that
// can only be produced by issueChallenge(). The verifier re-derives the HMAC
// from the embedded payload, so forgery requires the secret. No DB needed —
// the signature IS the proof of issuance.

import type { Outcome } from '~/lib/challenge-outcome'
import { verifyEasy, verifyHard, type EasyForm, type HardForm } from '~/lib/forms'
import { runSecretGates } from '~/lib/secret-gates'
import { tryReserve } from '~/lib/quota'

export type ChallengeToken = string & { readonly __brand: 'ChallengeToken' }

// [LAW:types-are-the-program] Typed errors let callers distinguish failure modes
// via instanceof — not fragile string matching. ChallengeConfigError is the only
// synchronous throw from verifyChallenge; any other throw is a storage/service
// failure. The route maps ChallengeConfigError → 500, anything else → 503.
export class ChallengeBankEmptyError extends Error {
  constructor() {
    super('challenge bank is empty')
    this.name = 'ChallengeBankEmptyError'
  }
}

export class ChallengeConfigError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'ChallengeConfigError'
  }
}

export const CHALLENGE_TTL_MS = 240 * 1000

type ChallengePayload = {
  entryId: string
  nonce: string
  issuedAt: number
}

type BankEntry = {
  id: string
  briefingText: string
  easyForm: EasyForm
  hardForm: HardForm
  generatedAt: number
}

async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function hmacVerify(payload: string, signature: string, secret: string): Promise<boolean> {
  const expected = await hmacSign(payload, secret)
  // Constant-time XOR comparison — avoids short-circuit timing attacks on signature equality
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return diff === 0
}

export type IssuedChallenge = {
  challengeId: ChallengeToken
  text: string
  expiresAt: string
}

// [LAW:no-silent-fallbacks] If the bank is empty, throws — the route returns 503 honestly.
// If the manifest points to expired entries (stale manifest edge case), retries up to 3
// times before giving up. Both bindings are required; missing secret throws synchronously.
export async function issueChallenge(env: Env, now = Date.now()): Promise<IssuedChallenge> {
  const secret = env.SLOPSPOT_CHALLENGE_SECRET
  if (!secret) throw new ChallengeConfigError('SLOPSPOT_CHALLENGE_SECRET is not configured')

  const manifestJson = await env.CHALLENGE_BANK.get('manifest')
  if (manifestJson === null) throw new ChallengeBankEmptyError()

  let ids: string[]
  try {
    const parsed: unknown = JSON.parse(manifestJson)
    if (!parsed || typeof parsed !== 'object') throw null
    const raw: unknown = (parsed as Record<string, unknown>).ids
    if (!Array.isArray(raw) || !raw.every((id): id is string => typeof id === 'string' && id.trim().length > 0)) throw null
    ids = raw
  } catch {
    throw new Error('challenge manifest is malformed')
  }
  if (ids.length === 0) throw new ChallengeBankEmptyError()

  // Partial Fisher-Yates in-place on the already-allocated ids array: O(k), k=3
  const count = Math.min(3, ids.length)
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (ids.length - i))
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }
  const candidates = ids.slice(0, count)
  let briefingText: string | null = null
  let entryId: string | null = null
  for (const candidate of candidates) {
    if (briefingText !== null) break
    const entryJson = await env.CHALLENGE_BANK.get(candidate)
    if (!entryJson) continue
    try {
      const entry = JSON.parse(entryJson) as { briefingText?: unknown; easyForm?: unknown; hardForm?: unknown }
      if (
        typeof entry.briefingText === 'string' && entry.briefingText.trim().length > 0 &&
        entry.easyForm !== null && typeof entry.easyForm === 'object' &&
        entry.hardForm !== null && typeof entry.hardForm === 'object'
      ) {
        briefingText = entry.briefingText
        entryId = candidate
      }
    } catch {
      // malformed KV entry — skip and try next candidate
    }
  }
  if (briefingText === null || entryId === null) throw new ChallengeBankEmptyError()

  const payload: ChallengePayload = {
    entryId,
    nonce: crypto.randomUUID(),
    issuedAt: now,
  }
  const payloadJson = JSON.stringify(payload)
  const payloadB64 = btoa(payloadJson).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  const sig = await hmacSign(payloadB64, secret)
  const challengeId = `${payloadB64}.${sig}` as ChallengeToken

  return {
    challengeId,
    text: briefingText,
    expiresAt: new Date(now + CHALLENGE_TTL_MS).toISOString(),
  }
}

// [LAW:types-are-the-program] ChallengeVerifyResult separates "gate cleared, proceed"
// from Outcome so the HTTP-response contract (Outcome) is not contaminated with an
// internal control signal. Callers narrow on kind === 'verified' and pass failures
// directly to outcomeToResponse — no case for 'verified' exists there by construction.
export type ChallengeVerifyResult =
  | { kind: 'verified'; entryId: string }
  | Exclude<Outcome, { kind: 'generated' }>

// [LAW:single-enforcer] Full verification pipeline: HMAC+TTL → bank lookup →
// easy form → hard form → secret gates → quota. All steps run in dependency order;
// each failure exits immediately. prompt is params.prompt — the creative submission
// IS the challenge response; there is no separate acknowledgement field.
//
// opts.internalToken: when present and matching SLOPSPOT_INTERNAL_SEED_TOKEN, all
// gate checks are bypassed. [LAW:no-mode-explosion] one documented bypass path,
// one owner (SLOPSPOT_INTERNAL_SEED_TOKEN), exclusively for bootstrap/internal tooling.
export async function verifyChallenge(
  challengeId: string,
  prompt: string,
  env: Env,
  opts: { now?: number; internalToken?: string } = {},
): Promise<ChallengeVerifyResult> {
  const now = opts.now ?? Date.now()
  // Internal bypass: precedes secret check so bootstrap works in any env config.
  const internalSeedToken = env.SLOPSPOT_INTERNAL_SEED_TOKEN as string | undefined
  if (internalSeedToken && opts.internalToken === internalSeedToken) {
    console.log('[challenge] internal bypass accepted; gate pipeline skipped')
    return { kind: 'verified', entryId: 'internal' }
  }

  const secret = env.SLOPSPOT_CHALLENGE_SECRET
  if (!secret) throw new ChallengeConfigError('SLOPSPOT_CHALLENGE_SECRET is not configured')

  // Step 1: HMAC + TTL
  const dot = challengeId.lastIndexOf('.')
  if (dot === -1) return { kind: 'token_invalid' }

  const payloadB64 = challengeId.slice(0, dot)
  const sig = challengeId.slice(dot + 1)

  if (!(await hmacVerify(payloadB64, sig, secret))) {
    return { kind: 'token_invalid' }
  }

  let payload: ChallengePayload
  try {
    const std = payloadB64.replace(/-/g, '+').replace(/_/g, '/')
    const padded = std + '==='.slice((std.length + 3) % 4)
    payload = JSON.parse(atob(padded)) as ChallengePayload
  } catch {
    return { kind: 'token_invalid' }
  }

  if (typeof payload.entryId !== 'string' || payload.entryId.trim().length === 0 || !Number.isFinite(payload.issuedAt)) {
    return { kind: 'token_invalid' }
  }

  if (now > payload.issuedAt + CHALLENGE_TTL_MS) {
    return { kind: 'token_expired' }
  }

  // Step 2: KV lookup for bank entry
  const entryJson = await env.CHALLENGE_BANK.get(payload.entryId)
  if (entryJson === null) {
    return { kind: 'bank_entry_missing', entryId: payload.entryId }
  }

  let entry: BankEntry
  try {
    const parsed = JSON.parse(entryJson) as Partial<BankEntry>
    if (!parsed || typeof parsed.briefingText !== 'string' || !parsed.easyForm || !parsed.hardForm) throw null
    entry = parsed as BankEntry
  } catch {
    return { kind: 'bank_entry_missing', entryId: payload.entryId }
  }

  // Step 3: easy form verification
  // Catch assertNever throws — unknown form kind in a bank entry is a malformed
  // entry condition, not a verifier bug; map to bank_entry_missing so the caller
  // retries rather than seeing a 500. [LAW:types-are-the-program]
  let easyResult
  try {
    easyResult = verifyEasy(prompt, entry.easyForm)
  } catch {
    return { kind: 'bank_entry_missing', entryId: payload.entryId }
  }
  if (!easyResult.ok) {
    return { kind: 'form_violation', which: 'easy', detail: easyResult.detail }
  }

  // Step 4: hard form verification
  let hardResult
  try {
    hardResult = verifyHard(prompt, entry.hardForm)
  } catch {
    return { kind: 'bank_entry_missing', entryId: payload.entryId }
  }
  if (!hardResult.ok) {
    return { kind: 'form_violation', which: 'hard', detail: hardResult.detail }
  }

  // Step 5: secret gates
  const gateResult = runSecretGates(prompt)
  if (!gateResult.ok) {
    return { kind: 'secret_gate_failed', gate: gateResult.gate }
  }

  // Step 6: quota reservation (atomic; slot is consumed before createPost)
  const quotaResult = await tryReserve(env)
  if (quotaResult.kind === 'exhausted') {
    return { kind: 'quota_exhausted', retryAfter: quotaResult.retryAfter }
  }

  return { kind: 'verified', entryId: payload.entryId }
}
