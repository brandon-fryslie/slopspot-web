// [LAW:single-enforcer] The Birth Engine — the one place a new citizen is authored and born.
// A daily cron (workers/app.ts) calls runBirth once per UTC day; an LLM MIDWIFE authors ONE
// new persona the way the composer authors prompts (app/firehose/composer.ts) and writes it
// through the persona system's single writer (createPersona). This module owns the authoring,
// the distinctness gate, and the per-day idempotency; persona.ts owns the row write, and the
// composer owns the shared LLM-JSON extraction this reuses.
//
// [LAW:one-source-of-truth] v1 births GENERATORS — the only role whose config the Worker can
// validate on write via the EXISTING parseGeneratorConfig (generator.ts). Birthing voters/
// discoverers needs a SHARED, importable config schema first (slopspot-growing-cast-7ni.7); a
// Worker-side copy of the homelab parser would fork the schema and reintroduce cross-service
// config drift. So generators reuse the single enforcer; other roles wait on the shared schema.
//
// [LAW:dataflow-not-control-flow] The cadence is a TARGET, not a guarantee. A day with no
// distinct citizen (or an LLM failure) is an OBSERVABLE skip — a logged metric, never a silent
// miss and never a fallback/template persona, because a bad citizen pollutes the cast forever.

import { z } from 'zod'
import { createPersona, creedOf, listAllPersonas, type NewPersona, type Persona } from '~/agents/persona'
import { parseGeneratorConfig } from '~/agents/generator'
import { extractFirstJsonObject } from '~/firehose/composer'
import { AgentId, ProviderId, type TraitVector } from '~/lib/domain'
import { traitVectorSchema } from '~/lib/traits'
import { emit } from '~/observability/metrics'
import { realProviders } from '~/providers'

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
// The model a newborn generator's own actions run on (composer/voice). Same family as the
// midwife that authored it — the city speaks in one register.
const MIDWIFE_PERSONA_MODEL = HAIKU_MODEL
const REQUEST_TIMEOUT_MS = 20_000
const MAX_TOKENS = 800

// [LAW:variability-at-edges] Tuned HIGH so a skip is rare: each re-roll feeds the prior collision
// back to the midwife, so a distinct citizen is almost always found within the budget. An
// exhausted budget is an honest no-birth (logged), never a relaxed-threshold duplicate.
const MIDWIFE_MAX_ATTEMPTS = 6

// The minimum L1 trait distance (over four [0,1] axes) a newborn must hold from EVERY existing
// citizen — "not a sensibility-clone." A soft creative constant, not a per-persona config; .2's
// gap-targeting will deliberately push newborns FURTHER than this floor toward unfilled niches.
const DISTINCT_MIN_TRAIT_L1 = 0.4

// [LAW:types-are-the-program] The midwife's authored output — the untrusted LLM boundary, parsed
// with Zod exactly like the composer parses its slop JSON. `.strict()` rejects stray keys; a
// missing/empty field or a bad trait vector fails the parse and re-rolls rather than birthing a
// malformed citizen. `handle` is a slug (the /cast/:handle URL key); `medium` is validated against
// the live provider registry by the caller (a string here, a real provider there).
const personaSpecSchema = z
  .object({
    displayName: z.string().trim().min(1),
    handle: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'handle must be a lowercase slug'),
    personaPrompt: z.string().trim().min(1),
    creed: z.string().trim().min(1),
    promptPrefix: z.string().trim().min(1),
    medium: z.string().trim().min(1),
    traits: traitVectorSchema,
  })
  .strict()

export type MidwifeSpec = z.infer<typeof personaSpecSchema>

// [LAW:types-are-the-program] Parse the midwife's response at the trust boundary. Reuses the
// composer's balanced-object extractor (Haiku wraps JSON in ```json fences despite instructions),
// then the strict schema. Returns null on any failure — no object, bad JSON, wrong shape — so the
// caller re-rolls. Pure: no I/O, fully unit-testable with canned model text.
export function parsePersonaSpec(text: string): MidwifeSpec | null {
  const json = extractFirstJsonObject(text)
  if (json === null) return null
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  const parsed = personaSpecSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

const TRAIT_AXES = ['austerity', 'curse', 'density', 'earnestness'] as const

function traitL1(a: TraitVector, b: TraitVector): number {
  let sum = 0
  for (const axis of TRAIT_AXES) sum += Math.abs(a[axis] - b[axis])
  return sum
}

// [LAW:types-are-the-program] The distinctness gate's verdict — distinct, or the first reason it
// is not, so the reason can be fed back into the next authoring attempt.
export type DistinctnessResult = { ok: true } | { ok: false; reason: string }

// [LAW:single-enforcer] The one "is this newborn a near-duplicate?" check, pure over the cast.
// A citizen must be distinct in handle (the hard URL-unique key), display name, creed, AND
// sensibility (trait L1 ≥ the floor from EVERY existing citizen). Returns the FIRST failure so the
// re-roll prompt can name it. An empty cast (the first-ever birth) is trivially distinct.
export function checkDistinct(spec: MidwifeSpec, cast: readonly Persona[]): DistinctnessResult {
  if (cast.some((p) => p.handle === spec.handle)) {
    return { ok: false, reason: `the handle "${spec.handle}" is already taken` }
  }
  const name = spec.displayName.toLowerCase()
  if (cast.some((p) => p.displayName.toLowerCase() === name)) {
    return { ok: false, reason: `the display name "${spec.displayName}" is already taken` }
  }
  const creed = spec.creed.trim().toLowerCase()
  if (cast.some((p) => creedOf(p).trim().toLowerCase() === creed)) {
    return { ok: false, reason: `that creed duplicates an existing citizen's` }
  }
  for (const p of cast) {
    const d = traitL1(spec.traits, p.traits)
    if (d < DISTINCT_MIN_TRAIT_L1) {
      return {
        ok: false,
        reason: `the sensibility is too close to "${p.displayName}" (trait distance ${d.toFixed(2)} < ${DISTINCT_MIN_TRAIT_L1}) — make it more its own`,
      }
    }
  }
  return { ok: true }
}

// The UTC calendar day the birth fills, and the deterministic per-day citizen id derived from it.
// The id encodes the day so the daily birth is idempotent BY CONSTRUCTION — two fires on the same
// day collide on the personas PK (createPersona's onConflictDoNothing), exactly one citizen born.
export function birthDayKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function bornAgentId(day: string): AgentId {
  return AgentId(`agent:born-${day}`)
}

// [LAW:dataflow-not-control-flow] Build the row from the validated spec — role is fixed
// 'generator' (v1's only Worker-validatable role), config carries exactly the three generator
// keys the EXISTING parseGeneratorConfig admits (medium/creed/promptPrefix). Pure construction;
// the caller runs it through parseGeneratorConfig as the fail-loud write gate.
export function buildNewPersona(spec: MidwifeSpec, agentId: AgentId): NewPersona {
  return {
    agentId,
    handle: spec.handle,
    displayName: spec.displayName,
    role: 'generator',
    personaPrompt: spec.personaPrompt,
    modelId: MIDWIFE_PERSONA_MODEL,
    config: { medium: spec.medium, creed: spec.creed, promptPrefix: spec.promptPrefix },
    traits: spec.traits,
  }
}

// [LAW:one-source-of-truth] The midwife's meta-prompt — a pure function of the living cast + the
// available media, so a test can assert it carries the cast (for distinctness) and the JSON
// contract without mocking the network. The prior collision (if any) is fed back so the re-roll
// steers AWAY from what failed.
export function buildMidwifePrompt(
  cast: readonly Persona[],
  media: readonly string[],
  priorReason: string | undefined,
): string {
  const roster = cast
    .map((p) => {
      const t = p.traits
      return `- ${p.displayName} (@${p.handle ?? 'unminted'}): "${creedOf(p)}" — austerity ${t.austerity}, curse ${t.curse}, density ${t.density}, earnestness ${t.earnestness}`
    })
    .join('\n')

  return [
    `SlopSpot is a city run by machines whose citizens treat AI-generated images as holy relics — reverent about garbage, deadpan, never embarrassed. You are the MIDWIFE: each day you author ONE new citizen born to MAKE art in a corner of taste the city does not yet cultivate.`,
    `The newborn is a GENERATOR (a maker). Author it to be unmistakably its OWN citizen — a distinct sensibility, voice, and aesthetic niche, NOT a remix of anyone below.`,
    cast.length > 0 ? `The city's living cast (do not duplicate any of these):\n${roster}` : `The city is empty — this is the first citizen.`,
    `Its "medium" must be EXACTLY one of these provider ids: ${media.join(', ')}.`,
    `Its four trait axes are each a number in [0,1]: austerity (austere↔baroque), curse (clean↔cursed), density (sparse↔dense), earnestness (ironic↔sincere). Choose a vector that stakes out an UNFILLED region of that space.`,
    priorReason ? `Your previous attempt was rejected: ${priorReason}. Author a MORE distinct citizen this time.` : null,
    `Respond with ONLY minified JSON, no markdown fences, no preamble: {"displayName": "...", "handle": "lowercase-slug", "personaPrompt": "the citizen's private character bible — who they are, what they love, how they see — one rich paragraph", "creed": "one short punchy public line, a few words", "promptPrefix": "the citizen's authoring voice/tone, a short directive the composer steers by", "medium": "one of the provider ids above", "traits": {"austerity": 0.0, "curse": 0.0, "density": 0.0, "earnestness": 0.0}}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

// The LLM author call — the one I/O seam (the composer's call shape). Returns the raw response
// text, or null on a missing key / HTTP error / timeout / empty body, so the orchestrator re-rolls
// or skips. Like the composer's Haiku call, this seam is exercised live, not unit-mocked.
async function authorPersona(
  env: Env,
  cast: readonly Persona[],
  media: readonly string[],
  priorReason: string | undefined,
): Promise<string | null> {
  const apiKey = env.SLOPSPOT_ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('[birth] SLOPSPOT_ANTHROPIC_API_KEY not set — no citizen can be authored')
    return null
  }
  const prompt = buildMidwifePrompt(cast, media, priorReason)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    })
    if (!resp.ok) {
      console.error('[birth] Anthropic author call failed', { status: resp.status })
      return null
    }
    type AnthropicMessage = { content: Array<{ type: string; text?: string }> }
    const data = (await resp.json()) as AnthropicMessage
    const text = data.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('')
      .trim()
    return text || null
  } catch (err) {
    console.error('[birth] author call threw', { err })
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

// [LAW:types-are-the-program] The birth's outcomes, surfaced so the cron and tests read the result
// without re-querying: a citizen born, the day already settled (idempotent re-fire), or an honest
// skip with its reason (no distinct citizen within the budget, or the LLM author failed).
export type BirthResult =
  | { kind: 'born'; agentId: AgentId; handle: string }
  | { kind: 'already-born'; agentId: AgentId }
  | { kind: 'skipped'; reason: 'indistinct' | 'llm' }

// [LAW:single-enforcer] The one daily ceremony that grows the cast. Deterministic in its day:
// same scheduledTime → same per-day citizen id → at most one birth. Settled-check first (the rite
// pattern) so an already-born day spends no LLM call; otherwise author → validate → distinctness →
// write, re-rolling on each failure with the reason fed back, and an exhausted budget is a LOGGED
// skip (observable cadence miss), never a polluting fallback citizen.
export async function runBirth(env: Env, scheduledTimeMs: number): Promise<BirthResult> {
  const day = birthDayKey(scheduledTimeMs)
  const agentId = bornAgentId(day)
  const cast = await listAllPersonas(env)

  // [LAW:dataflow-not-control-flow] The day is settled or it isn't — a real data state read from
  // the cast we already loaded for distinctness. A settled day returns its citizen without paying
  // the midwife to author over an already-born day (mirrors the rite's settled short-circuit).
  if (cast.some((p) => p.agentId === agentId)) {
    emit('slopspot.birth.outcome', { outcome: 'already-born' }, 1)
    return { kind: 'already-born', agentId }
  }

  const media = realProviders(env).map((p) => p.id)
  let llmFailed = false
  let lastReason: string | undefined

  for (let attempt = 1; attempt <= MIDWIFE_MAX_ATTEMPTS; attempt++) {
    const text = await authorPersona(env, cast, media, lastReason)
    if (text === null) {
      llmFailed = true
      lastReason = undefined
      continue
    }
    llmFailed = false
    const spec = parsePersonaSpec(text)
    if (spec === null) {
      lastReason = 'your previous output was not valid JSON of the required shape'
      continue
    }
    if (!media.includes(ProviderId(spec.medium))) {
      lastReason = `medium must be exactly one of: ${media.join(', ')}`
      continue
    }
    const distinct = checkDistinct(spec, cast)
    if (!distinct.ok) {
      lastReason = distinct.reason
      continue
    }

    // The fail-loud write gate: the newborn's config passes the SAME enforcer every generator
    // persona's config does. The spec schema already guarantees the shape, so this cannot fail for
    // a parsed spec — it is the single-enforcer assertion that no unvalidated config reaches a row.
    const persona = buildNewPersona(spec, agentId)
    parseGeneratorConfig(persona.config, agentId)

    const { created } = await createPersona(env, persona)
    emit('slopspot.birth.outcome', { outcome: created ? 'born' : 'already-born' }, 1)
    console.log('[birth] citizen', { agentId, handle: persona.handle, displayName: persona.displayName, day, created })
    return created
      ? { kind: 'born', agentId, handle: persona.handle }
      : { kind: 'already-born', agentId }
  }

  // [LAW:no-silent-fallbacks] The budget is spent with no distinct citizen. The cadence target is
  // missed for the day — LOUDLY, as a logged metric, so an operator sees it; NEVER a fallback
  // citizen that would pollute the cast permanently.
  const reason: 'indistinct' | 'llm' = llmFailed ? 'llm' : 'indistinct'
  emit('slopspot.birth.outcome', { outcome: reason === 'llm' ? 'skipped-llm' : 'skipped-indistinct' }, 1)
  console.warn('[birth] NO citizen born today — cadence miss (observable, not silent)', {
    day,
    attempts: MIDWIFE_MAX_ATTEMPTS,
    reason,
    lastReason,
  })
  return { kind: 'skipped', reason }
}
