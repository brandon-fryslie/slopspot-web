// [LAW:single-enforcer] The one Anthropic Haiku transport leaf. Every module that
// calls Haiku consumes this — the composer (prompt authoring) and verdict re-voice
// (w2v.7). Timeout, error types, and response-extraction logic all live here exactly
// once. Callers never touch the Anthropic REST API directly.
// [LAW:one-way-deps] Pure outbound HTTP + env — no back-edge.

import { healthFromHttpStatus, reportAccountHealth } from '~/observability/account-health'

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const REQUEST_TIMEOUT_MS = 15_000

// [LAW:types-are-the-program] Carry the HTTP status ON the thrown value so the
// catch at the call site classifies the fallback reason from DATA, not by re-parsing
// a message string. A 401/403 (auth — key dead/expired) is operator-actionable and
// distinct from a transient 5xx or a network throw.
export class AnthropicHttpError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`Anthropic ${status}: ${body}`)
  }
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

// [LAW:single-enforcer] One Haiku call: env + options → raw text response. Throws
// MissingApiKeyError when the key is absent; throws AnthropicHttpError on a non-2xx
// response; throws on an empty text block; throws on timeout (aborted signal). The
// caller is responsible for fallback policy — this leaf is the transport only.
//
// [LAW:single-enforcer] Account health for the Anthropic credential is reported HERE, in the one
// transport every Anthropic caller flows through — so a new caller reports by construction and
// cannot forget. [LAW:dataflow-not-control-flow] exactly one health sample is reported per call,
// the DATA deciding which: a 2xx is ok (a recovered key auto-resolves the page); 401/403 and a
// missing key are down{auth}; 402/429 map to payment/quota; a network throw or timeout is the
// transient degraded that never pages. (The streaming Anthropic call in api.rewrite-prompt.ts
// bypasses this leaf and reports at its own site — a pre-existing single-enforcer gap, tracked.)
export async function callHaiku(env: Env, opts: HaikuOptions): Promise<string> {
  if (!env.SLOPSPOT_ANTHROPIC_API_KEY) {
    reportAccountHealth('anthropic', { status: 'down', reason: 'auth' })
    throw new MissingApiKeyError()
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const body: Record<string, unknown> = {
      model: HAIKU_MODEL,
      max_tokens: opts.maxTokens,
      messages: [{ role: 'user', content: opts.user }],
    }
    if (opts.system) body.system = opts.system

    let resp: Response
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.SLOPSPOT_ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (err) {
      // Network failure or timeout abort — the credential is not implicated, so this is
      // the transient state that self-heals and never pages.
      reportAccountHealth('anthropic', { status: 'degraded' })
      throw err
    }

    if (!resp.ok) {
      const responseBody = await resp.text()
      reportAccountHealth('anthropic', healthFromHttpStatus(resp.status))
      throw new AnthropicHttpError(resp.status, responseBody)
    }

    // A 2xx means the credential is healthy regardless of body shape — an empty text block
    // below is a content fault, never an account-down, so health is reported ok here.
    reportAccountHealth('anthropic', { status: 'ok' })

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
