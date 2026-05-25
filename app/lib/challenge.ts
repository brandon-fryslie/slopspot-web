// [LAW:single-enforcer] The one place that defines, issues, and verifies
// challenge tokens. Both /api/challenge (issuer) and /api/generate (verifier)
// import from here — the logic lives in neither route.
//
// [LAW:types-are-the-program] ChallengeToken is a branded opaque string that
// can only be produced by issueChallenge(). The verifier re-derives the HMAC
// from the embedded payload, so forgery requires the secret. No DB needed —
// the signature IS the proof of issuance.

export type ChallengeToken = string & { readonly __brand: 'ChallengeToken' }

// [LAW:types-are-the-program] Typed error lets the route distinguish empty-bank
// (503) from misconfiguration (500) via instanceof — not fragile string matching.
export class ChallengeBankEmptyError extends Error {
  constructor() {
    super('challenge bank is empty')
    this.name = 'ChallengeBankEmptyError'
  }
}

export const CHALLENGE_TTL_MS = 240 * 1000

type ChallengePayload = {
  entryId: string
  nonce: string
  issuedAt: number
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
  if (!secret) throw new Error('SLOPSPOT_CHALLENGE_SECRET is not configured')

  const manifestJson = await env.CHALLENGE_BANK.get('manifest')
  if (!manifestJson) throw new ChallengeBankEmptyError()

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
      const entry = JSON.parse(entryJson) as { briefingText?: unknown }
      if (typeof entry.briefingText === 'string' && entry.briefingText.trim().length > 0) {
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

// wrong_ack remains in the union to keep api.generate.ts compiling until dqx.7
// removes the acknowledgement field from the generate-route body schema.
// [LAW:one-way-deps] dqx.7 owns that deletion; this file does not reach into routes.
export type VerifyResult =
  | { ok: true; entryId: string }
  | { ok: false; reason: 'malformed' | 'invalid_signature' | 'expired' | 'wrong_ack' }

// acknowledgement parameter is accepted for api.generate.ts compat; dqx.7 removes it.
export async function verifyChallenge(
  challengeId: string,
  _acknowledgement: string,
  secret: string,
  now = Date.now(),
): Promise<VerifyResult> {
  if (!secret) throw new Error('SLOPSPOT_CHALLENGE_SECRET is not configured')
  const dot = challengeId.lastIndexOf('.')
  if (dot === -1) return { ok: false, reason: 'malformed' }

  const payloadB64 = challengeId.slice(0, dot)
  const sig = challengeId.slice(dot + 1)

  if (!(await hmacVerify(payloadB64, sig, secret))) {
    return { ok: false, reason: 'invalid_signature' }
  }

  let payload: ChallengePayload
  try {
    // Restore standard base64 padding before atob — the encoded form strips '='
    const std = payloadB64.replace(/-/g, '+').replace(/_/g, '/')
    const padded = std + '==='.slice((std.length + 3) % 4)
    payload = JSON.parse(atob(padded)) as ChallengePayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  // Runtime guard: missing/non-string entryId or non-numeric issuedAt means the
  // token was forged or issued by a different version of this code.
  if (typeof payload.entryId !== 'string' || payload.entryId.trim().length === 0 || !Number.isFinite(payload.issuedAt)) {
    return { ok: false, reason: 'malformed' }
  }

  if (now > payload.issuedAt + CHALLENGE_TTL_MS) {
    return { ok: false, reason: 'expired' }
  }

  return { ok: true, entryId: payload.entryId }
}
