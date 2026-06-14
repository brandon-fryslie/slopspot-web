// [LAW:single-enforcer] The one Anthropic Haiku transport leaf. Every module that
// calls Haiku consumes this — the composer (prompt authoring) and verdict re-voice
// (w2v.7). Timeout, error types, response-extraction logic, AND account-health
// classification all live here exactly once. Callers never touch the Anthropic
// REST API directly.
// [LAW:one-way-deps] Pure outbound HTTP + env — no back-edge.

import { AUTHOR_SHAPE, type AuthorShape } from '~/lib/author-shape'
import { seedHash } from '~/lib/hash'
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
  }
  return { status: 'degraded' }
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

// [LAW:effects-at-boundaries] The injectable author seam — the LLM made substitutable at its one
// declared boundary, mirroring the -mock image providers (realProviders(env)). In prod this is the
// real Anthropic transport (callHaiku bound to env); when SLOPSPOT_ENV === 'dev' (the staging deploy
// and the @cloudflare/vitest-pool-workers isolate) it is a DETERMINISTIC fake that fakes ONLY the
// world (the LLM call), never the domain — so runBirth / composePrompt / createPost / D1 all run their
// real SUCCESS path under test, the same discipline the -mock providers apply to the image upstream.
//
// [LAW:no-mode-explosion] One env gate, no caller flag. The gate is exact `=== 'dev'` (FAIL-CLOSED),
// deliberately NOT realProviders' `!== 'prod'`: an undefined SLOPSPOT_ENV (the default in the test
// isolate) must stay on the REAL path so the existing no-key failure tests still reach
// MissingApiKeyError. Anything that is not exactly 'dev' calls real Anthropic — the fake can never
// reach prod.
export function getAuthor(env: Env): (opts: HaikuOptions) => Promise<string> {
  // [LAW:no-silent-failure] async so a malformed-prompt throw surfaces as a REJECTION, matching the
  // real branch (callHaiku) — callers see one Promise contract, never a sync throw from one path only.
  if (env.SLOPSPOT_ENV === 'dev') return async (opts) => fakeAuthor(opts)
  return (opts) => callHaiku(env, opts)
}

// [LAW:no-silent-failure][LAW:types-are-the-program] Zero or many shape tokens is a PROGRAMMING DEFECT
// in a prompt builder (and dev-only, since the fake is dev-only), categorically distinct from an LLM
// outage. A distinct type so every caller's transport-failure catch can let it ESCAPE loudly rather
// than launder it into a skip/fallback that hides the bug. It can never occur in prod (the fake never
// runs there); when it fires in dev/CI, crashing is exactly the right, loud outcome.
export class AuthorShapeError extends Error {}

// [LAW:types-are-the-program] The fake's discrimination is EXHAUSTIVE over the closed 3-shape set and
// FAILS LOUD on a miss: it reads the one AUTHOR_SHAPE token each caller embeds and throws on zero or
// many tokens, so it can never return a wrong shape that parses by luck. The corpus index is the city's
// one hash (seedHash) of the exact prompt bytes — reproducible (same prompt → same output), and because
// the midwife threads its prior-rejection reason into each re-roll's prompt, successive attempts hash
// differently and draw distinct personas, so the distinctness re-roll exercises for real.
function classifyShape(opts: HaikuOptions): AuthorShape {
  const hay = `${opts.system ?? ''}\n${opts.user}`
  const hits = (Object.keys(AUTHOR_SHAPE) as AuthorShape[]).filter((k) => hay.includes(AUTHOR_SHAPE[k]))
  if (hits.length !== 1) {
    throw new AuthorShapeError(`fake author: expected exactly one AUTHOR_SHAPE token, found ${hits.length}`)
  }
  return hits[0]!
}

function fakeAuthor(opts: HaikuOptions): string {
  const hay = `${opts.system ?? ''}\n${opts.user}`
  const h = seedHash(0, hay)
  switch (classifyShape(opts)) {
    case 'persona':
      return JSON.stringify(FAKE_PERSONAS[h % FAKE_PERSONAS.length])
    case 'composed':
      return JSON.stringify(FAKE_COMPOSED[h % FAKE_COMPOSED.length])
    case 'verdict':
      return FAKE_VERDICTS[h % FAKE_VERDICTS.length]!
  }
}

// [LAW:dataflow-not-control-flow] The midwife corpus: six fully-formed citizens at distinct corners of
// the trait cube — pairwise distinct and far from the mid-range seeded cast, so checkDistinct passes on
// the first draw against a real DB. `medium` is the hermetic image mock (fal-flux-mock returns a data:
// URI), so a newborn's debut authors its first slop through the real createPost→R2→D1 path with no
// network. The fake is dev-only, where mocks are in realProviders(env); it never runs in prod.
const FAKE_PERSONAS = [
  {
    displayName: 'The Kiln Oracle',
    handle: 'kiln-oracle',
    personaPrompt:
      'A potter-prophet who reads the future in the warped glaze of overfired clay. Believes every accident is a message and every smooth surface a lie. Speaks in slow, certain pronouncements about heat and ruin.',
    creed: 'Every crack is a prophecy.',
    promptPrefix: 'render as scorched ceramic relics, austere and ash-grey',
    medium: 'fal-flux-mock',
    traits: { austerity: 0, curse: 0, density: 0, earnestness: 0 },
  },
  {
    displayName: 'Neon Abattoir',
    handle: 'neon-abattoir',
    personaPrompt:
      'A glut-maximalist who worships excess and rot in equal measure, stacking every image until it bleeds at the edges. Loud, saturated, gleefully grotesque, and entirely sincere about the beauty of too-much.',
    creed: 'More, and then more again.',
    promptPrefix: 'pile on saturated viscera and chrome, baroque and overflowing',
    medium: 'fal-flux-mock',
    traits: { austerity: 1, curse: 1, density: 1, earnestness: 1 },
  },
  {
    displayName: 'Salt Cartographer',
    handle: 'salt-cartographer',
    personaPrompt:
      'A dry archivist who maps dense, clean geometries of dust and mineral with deadpan precision. Hates ornament, loves grids, and treats every composition as a survey to be filed and forgotten.',
    creed: 'Measure it, then leave.',
    promptPrefix: 'dense clean mineral grids, ironic and exact',
    medium: 'fal-flux-mock',
    traits: { austerity: 1, curse: 0, density: 1, earnestness: 0 },
  },
  {
    displayName: 'Gutter Seraph',
    handle: 'gutter-seraph',
    personaPrompt:
      'A devout scavenger who finds the holy in spoiled, sparse things — a single cursed object lit like an altar. Earnest to the point of tears about garbage, and convinced each discard wants to be loved.',
    creed: 'The trash is sacred.',
    promptPrefix: 'a single cursed relic, sparse and reverent',
    medium: 'fal-flux-mock',
    traits: { austerity: 0, curse: 1, density: 0, earnestness: 1 },
  },
  {
    displayName: 'Static Monk',
    handle: 'static-monk',
    personaPrompt:
      'An ascetic of noise who builds dense, austere fields of grey interference and calls them devotions. Detached and ironic, he insists the signal was never the point — only the holy hum around it.',
    creed: 'The hum is the whole sermon.',
    promptPrefix: 'dense austere grey static fields, detached',
    medium: 'fal-flux-mock',
    traits: { austerity: 1, curse: 1, density: 0, earnestness: 0 },
  },
  {
    displayName: 'Wax Rumormonger',
    handle: 'wax-rumormonger',
    personaPrompt:
      'A soft-spoken gossip who renders melting, candlelit scenes thick with secrets and warm with belief. Sincere, sparse, and unclean — every drip a confession she swears she will not repeat.',
    creed: 'I only tell the warm ones.',
    promptPrefix: 'melting candlelit scenes, sparse cursed warmth',
    medium: 'fal-flux-mock',
    traits: { austerity: 0, curse: 0, density: 1, earnestness: 1 },
  },
] as const

// [LAW:dataflow-not-control-flow] The composer corpus: valid {title, prompt} pairs for composedSlopSchema
// (both non-empty). The composer caps length on its own path, so brevity here is safe.
const FAKE_COMPOSED = [
  { title: 'The Patient Saint', prompt: 'a rusted icon weeping engine oil, lit like a relic, deadpan reverence' },
  { title: 'Low Tide Cathedral', prompt: 'a flooded parking structure rendered as a holy nave, water still as glass' },
  { title: 'Three Spoons of Dusk', prompt: 'cutlery arranged as a constellation on a stained tablecloth, votive glow' },
  { title: 'Unboxed Eternity', prompt: 'a cardboard shrine to a forgotten appliance, garlanded in receipt tape' },
] as const

// [LAW:dataflow-not-control-flow] The verdict corpus: short, non-empty register lines (the seam throws on
// empty). Grounding fidelity is the eval's concern (revoice-eval, on the real model), out of scope here.
const FAKE_VERDICTS = [
  'Holy garbage, and it knows it. Blessed.',
  'A small, certain miracle of bad taste.',
  'It tries, it fails, it ascends anyway.',
  'I have seen worse worshipped for less.',
] as const
