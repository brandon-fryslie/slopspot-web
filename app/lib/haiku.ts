// [LAW:single-enforcer] The one Anthropic Haiku transport leaf. Every module that
// calls Haiku consumes this — the composer (prompt authoring) and verdict re-voice
// (w2v.7). Timeout, error types, response-extraction logic, AND account-health
// classification all live here exactly once. Callers never touch the Anthropic
// REST API directly.
// [LAW:one-way-deps] Pure outbound HTTP + env — no back-edge.

import type { AccountHealthPayload } from '~/observability/metrics'

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const REQUEST_TIMEOUT_MS = 15_000

// [LAW:types-are-the-program] Carry the HTTP status ON the thrown value so the
// catch at the call site classifies the fallback reason from DATA, not by re-parsing
// a message string. A 401/403 (auth — key dead/expired) is operator-actionable and
// distinct from a transient 5xx or a network throw.
export class AnthropicHttpError extends Error {
  constructor(
    readonly status: number,
    // [LAW:types-are-the-program] Carry the raw response body AS DATA, not only folded
    // into the message string — the credit-exhaustion classifier reads it directly
    // rather than re-parsing a reconstructed message.
    readonly body: string,
  ) {
    super(`Anthropic ${status}: ${body}`)
  }
}

// [LAW:single-enforcer] Anthropic reports an exhausted credit balance as an HTTP 400
// invalid_request_error (NOT 402) — the account-down signal is carried ONLY in the body
// text, indistinguishable by status from a genuinely malformed request. Detect it at this
// account trust boundary by its stable phrase (the per-account error knowledge the
// account-health design calls for, like a provider's upstream-response parser). The
// phrase is the one Anthropic returns for billing exhaustion; matched case-insensitively
// against the raw body so a non-JSON or reshaped error envelope still classifies.
const CREDIT_EXHAUSTED_PHRASE = 'credit balance is too low'

function isCreditExhausted(body: string): boolean {
  return body.toLowerCase().includes(CREDIT_EXHAUSTED_PHRASE)
}

// [LAW:types-are-the-program] Distinct from AnthropicHttpError: the key is absent
// in the environment (local dev without .dev.vars, CI without secrets). Callers that
// want to degrade gracefully (composer → recipe fallback) catch this type; callers
// that require a key (verdict re-voice) let it propagate.
export class MissingApiKeyError extends Error {
  constructor() {
    super('SLOPSPOT_ANTHROPIC_API_KEY not set')
  }
}

export type HaikuOptions = {
  // Optional system prompt — verdict re-voice puts persona prompt + register here;
  // the composer folds its steer into the user message directly.
  system?: string
  user: string
  maxTokens: number
}

// [LAW:single-enforcer] The ONE classifier for Anthropic call outcomes → account-health axis.
// Callers pass any caught error; this returns the typed payload for emitAccountHealth.
// [LAW:dataflow-not-control-flow] the error value drives the classification; no caller
// re-implements this mapping.
export function classifyAnthropicHealth(err: unknown): AccountHealthPayload {
  if (err instanceof MissingApiKeyError) return { status: 'down', reason: 'auth' }
  if (err instanceof AnthropicHttpError) {
    if (err.status === 401 || err.status === 403) return { status: 'down', reason: 'auth' }
    if (err.status === 402) return { status: 'down', reason: 'payment' }
    if (err.status === 429) return { status: 'down', reason: 'quota' }
    // [LAW:no-silent-failure] Credit exhaustion arrives as a 400; left in the `degraded`
    // bucket below it would be treated as a self-healing blip and NEVER page — the exact
    // silent money-failure the account-health alert exists to catch. It does not self-heal.
    if (isCreditExhausted(err.body)) return { status: 'down', reason: 'payment' }
  }
  return { status: 'degraded' }
}

// [LAW:effects-at-boundaries] In non-prod, getAuthor returns a deterministic fake that
// exercises the domain path without a live Anthropic call — the same boundary substitution
// the -mock image providers make. Same gate as realProviders(env): SLOPSPOT_ENV === 'prod'
// uses the real transport; anything else (dev, staging, test isolate) uses the fake.
//
// The fake is shape-valid for each caller's parser:
//   - midwife prompt always includes "You are the MIDWIFE" → returns valid persona JSON
//   - re-voice calls always set opts.system → returns a short text line
//   - composer prompts (no system, no MIDWIFE) → returns valid composer JSON
//
// [LAW:no-mode-explosion] No extra flag or second function — the env alone selects the
// transport, and the prompt content selects the response corpus entry.
const FAKE_PERSONA_SPEC = JSON.stringify({
  displayName: 'The Archivist of Dust',
  handle: 'archivist-of-dust',
  personaPrompt:
    'A citizen devoted to the overlooked — cataloguing the forgotten corners of taste with exhausting precision. Finds beauty in the mundane, tragedy in the ignored.',
  creed: 'The overlooked is the holy.',
  promptPrefix: 'Render as if unearthed from a forgotten archive:',
  medium: 'fal-flux-mock',
  traits: { austerity: 0.7, curse: 0.2, density: 0.5, earnestness: 0.8 },
})
const FAKE_COMPOSER_SLOP = JSON.stringify({
  prompt:
    'A luminous digital still of shattered glass caught mid-fall, each shard reflecting a different forgotten world, cold blue light, hyperreal.',
  title: 'Shard Archive',
})
const FAKE_REVOICE_TEXT =
  'This image carries the weight of machine memory — precise and cold, as if the algorithm itself mourned what it made.'

export function getAuthor(env: Env): (opts: HaikuOptions) => Promise<string> {
  if (env.SLOPSPOT_ENV !== 'dev') return (opts) => callHaiku(env, opts)
  return (opts) => {
    if (opts.user.includes('You are the MIDWIFE')) return Promise.resolve(FAKE_PERSONA_SPEC)
    if (opts.system !== undefined) return Promise.resolve(FAKE_REVOICE_TEXT)
    return Promise.resolve(FAKE_COMPOSER_SLOP)
  }
}

// [LAW:single-enforcer] One Haiku call: env + options → raw text response. Throws
// MissingApiKeyError when the key is absent; throws AnthropicHttpError on a non-2xx
// response; throws on an empty text block; throws on timeout (aborted signal). The
// caller is responsible for fallback policy — this leaf is the transport only.
export async function callHaiku(env: Env, opts: HaikuOptions): Promise<string> {
  if (!env.SLOPSPOT_ANTHROPIC_API_KEY) throw new MissingApiKeyError()

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const body: Record<string, unknown> = {
      model: HAIKU_MODEL,
      max_tokens: opts.maxTokens,
      messages: [{ role: 'user', content: opts.user }],
    }
    if (opts.system) body.system = opts.system

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.SLOPSPOT_ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!resp.ok) {
      const responseBody = await resp.text()
      throw new AnthropicHttpError(resp.status, responseBody)
    }

    type AnthropicMessage = { content: Array<{ type: string; text?: string }> }
    const data = (await resp.json()) as AnthropicMessage
    const text = data.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('')
      .trim()

    if (!text) throw new Error('empty text block in Anthropic response')
    return text
  } finally {
    clearTimeout(timeoutId)
  }
}
