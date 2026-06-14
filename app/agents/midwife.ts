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
import { debutNewcomer } from '~/agents/debut'
import { proprietorRef } from '~/agents/rite'
import { getLineageDag } from '~/db/genome-dag'
import { recordUtterance } from '~/db/utterances'
import { extractFirstJsonObject } from '~/firehose/composer'
import { AUTHOR_SHAPE } from '~/lib/author-shape'
import { getAuthor } from '~/lib/haiku'
import { AgentId, ProviderId, type TraitVector } from '~/lib/domain'
import { traitVectorSchema } from '~/lib/traits'
import { utter, type Newcomer } from '~/lib/voice'
import { emit } from '~/observability/metrics'
import { realProviders } from '~/providers'

// The model a newborn generator's own actions run on (composer/voice). Same Haiku family as the
// midwife transport that authored it (callHaiku in haiku.ts) — the city speaks in one register.
const MIDWIFE_PERSONA_MODEL = 'claude-haiku-4-5-20251001'
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

// [LAW:one-source-of-truth] The gap-bias reads ONE taste-landscape: the cast's sensibilities
// (where citizens already live) against the art the city has actually made (where taste has been
// cultivated). No parallel taste model — castTraits are persona traits, artTraits are genome traits
// (getLineageDag nodes, the SAME reader the deviance ballot folds over). The trait-L1 metric is the
// single one this module already owns.

// Mean number of art points to average for the gap target — a small-K mean so one outlier art point
// does not yank the target into a single freak region; the centroid of the most-radiated-into
// corner is a steadier aim than its single furthest point.
const GAP_STABILITY_K = 3

// The L1 distance from a point to the NEAREST member of a set — "how far is this from the closest
// thing already here." Infinity for an empty set (nothing to be near), which falls out of the data.
function nearestL1(point: TraitVector, others: readonly TraitVector[]): number {
  let min = Infinity
  for (const o of others) {
    const d = traitL1(point, o)
    if (d < min) min = d
  }
  return min
}

// The component-wise centroid of trait vectors — stays in [0,1] because every input axis is. Caller
// guarantees a non-empty input (the only caller slices a ranked non-empty list).
function meanTraits(vectors: readonly TraitVector[]): TraitVector {
  const out: TraitVector = { austerity: 0, curse: 0, density: 0, earnestness: 0 }
  for (const v of vectors) for (const axis of TRAIT_AXES) out[axis] += v[axis]
  for (const axis of TRAIT_AXES) out[axis] /= vectors.length
  return out
}

// [LAW:types-are-the-program] The under-cultivated region of the taste cube, or `null` when there is
// no landscape to read (no cast OR no art). PURE. The art point that radiated FURTHEST from every
// citizen marks where taste was made but no citizen lives; the centroid of the top-K such points is
// the steady aim. `null` is the honest "no bias possible" state — the prompt directive and the gate
// both degrade through it by DATA, never by a skip branch in the caller.
export function gapTarget(
  castTraits: readonly TraitVector[],
  artTraits: readonly TraitVector[],
): TraitVector | null {
  if (castTraits.length === 0 || artTraits.length === 0) return null
  const ranked = artTraits
    .map((art) => ({ art, d: nearestL1(art, castTraits) }))
    .sort((a, b) => b.d - a.d)
  return meanTraits(ranked.slice(0, GAP_STABILITY_K).map((r) => r.art))
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!
}

// [LAW:single-enforcer] The "did the newborn actually land in a less-crowded region?" check, PURE,
// returning the SAME verdict shape distinctness does so a clump folds into the same re-roll loop.
// The bar: the newborn's distance to its nearest citizen must EXCEED the cast's median nearest-
// neighbor distance — it must sit emptier than a typical citizen does. [LAW:dataflow-not-control-flow]
// Two degenerate states resolve to a real verdict (ok, nothing to reject against), not a skipped
// operation: `gap === null` means we never steered (no taste-landscape), so there is no gap to hold
// the newborn to; fewer than two citizens means no crowding baseline exists to exceed. Both are data
// states of the same always-running gate, not branches that skip it.
export function gapGate(
  newbornTraits: TraitVector,
  castTraits: readonly TraitVector[],
  gap: TraitVector | null,
): DistinctnessResult {
  if (gap === null || castTraits.length < 2) return { ok: true }
  const baseline = median(
    castTraits.map((c, i) => nearestL1(c, castTraits.filter((_, j) => j !== i))),
  )
  const newbornNearest = nearestL1(newbornTraits, castTraits)
  if (newbornNearest <= baseline) {
    return {
      ok: false,
      reason: `the sensibility clumps into an already-crowded region (nearest citizen ${newbornNearest.toFixed(2)} ≤ the city's typical crowding ${baseline.toFixed(2)}) — push further into the under-watched gap`,
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
  gap: TraitVector | null,
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
    gap
      ? `You are BORN TO FILL A GAP. The city's art has been radiating toward a corner of taste that no citizen yet lives in: near austerity ${gap.austerity.toFixed(2)}, curse ${gap.curse.toFixed(2)}, density ${gap.density.toFixed(2)}, earnestness ${gap.earnestness.toFixed(2)}. Aim the newborn's trait vector NEAR there — you may vary, but lean hard into this under-watched region so the cast spreads across taste-space rather than clumping.`
      : null,
    priorReason ? `Your previous attempt was rejected: ${priorReason}. Author a MORE distinct citizen this time.` : null,
    `Respond with ONLY minified JSON, no markdown fences, no preamble: {"displayName": "...", "handle": "lowercase-slug", "personaPrompt": "the citizen's private character bible — who they are, what they love, how they see — one rich paragraph", "creed": "one short punchy public line, a few words", "promptPrefix": "the citizen's authoring voice/tone, a short directive the composer steers by", "medium": "one of the provider ids above", "traits": {"austerity": 0.0, "curse": 0.0, "density": 0.0, "earnestness": 0.0}} ${AUTHOR_SHAPE.persona}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

// [LAW:single-enforcer] The LLM author call now goes through the ONE Anthropic seam (getAuthor →
// callHaiku), not a second inline fetch — so the midwife shares the transport leaf's timeout, error
// types, and account-health classification instead of forking them. [LAW:effects-at-boundaries] In
// dev/staging + the test isolate getAuthor returns the deterministic fake, so the SUCCESS path (a
// distinct citizen authored, parsed, gated, written) is reachable under test, not only the skip path.
// Returns the raw response text, or null on any failure (missing key / HTTP error / timeout / empty
// body all surface as a thrown value here), so the orchestrator re-rolls or skips — the contract the
// re-roll loop reads is unchanged.
async function authorPersona(
  env: Env,
  cast: readonly Persona[],
  media: readonly string[],
  gap: TraitVector | null,
  priorReason: string | undefined,
): Promise<string | null> {
  try {
    return await getAuthor(env)({
      user: buildMidwifePrompt(cast, media, gap, priorReason),
      maxTokens: MAX_TOKENS,
    })
  } catch (err) {
    console.error('[birth] author call failed — no citizen authored this attempt', { err })
    return null
  }
}

// [LAW:types-are-the-program] The birth's outcomes, surfaced so the cron and tests read the result
// without re-querying: a citizen born, the day already settled (idempotent re-fire), or an honest
// skip with its reason (no distinct citizen within the budget, or the LLM author failed).
export type BirthResult =
  | { kind: 'born'; agentId: AgentId; handle: string }
  | { kind: 'already-born'; agentId: AgentId }
  | { kind: 'skipped'; reason: 'indistinct' | 'llm' }

// [LAW:single-enforcer] The Birth Rite — the Proprietor welcomes a newborn through the ONE Voice
// mechanism (utter → recordUtterance), the same way the Daily Rite voices its decree. Voice NARRATES a
// birth that ALREADY happened: this runs only AFTER the persona row is written, so the announcement is
// the consequence of a real birth, never its cause. Exported (not inlined) so the gate is verifiable
// without the LLM author path — given a born citizen, this records exactly one welcome.
//
// [LAW:no-silent-fallbacks] ISOLATED + TOTAL: the birth (the persona row) is PRIMARY TRUTH; this welcome
// is best-effort NARRATION. A failure here (the Proprietor unseated, a D1 write error) must NOT un-birth a
// citizen, so it is caught and surfaced on its OWN signal (slopspot.birth.announce + a loud log) rather
// than propagated as a birth failure. Never silent — the failed welcome is observable, and the deeper
// re-attempt-on-absent-utterance idempotency is a filed follow-up. utter() itself never throws (speak()
// degrades to Withheld{unavailable}); the catch covers proprietorRef + the recordUtterance D1 write.
// [LAW:dataflow-not-control-flow] No double-announce is FREE: the caller gates this on createPersona's
// `created` boolean, so a settled-day re-run (created:false) never reaches here — the announcement rides
// the birth's OWN idempotency (the personas PK), never a second utterances-table dedup that could drift.
export async function announceBirth(env: Env, newcomer: Newcomer): Promise<void> {
  try {
    const proprietor = await proprietorRef(env)
    // A birth has no post target — the welcome is about a citizen, not a slop.
    const utterance = await utter(proprietor, 'birth', newcomer, {})
    await recordUtterance(env, {
      speaker: proprietor.handle,
      occasion: 'birth',
      targetPostId: null,
      utterance,
    })
    emit('slopspot.birth.announce', { outcome: utterance.kind }, 1)
  } catch (err) {
    emit('slopspot.birth.announce', { outcome: 'failed' }, 1)
    console.error('[birth] welcome failed — citizen born but unannounced (observable, not an un-birth)', {
      displayName: newcomer.displayName,
      err,
    })
  }
}

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

  // [LAW:one-source-of-truth] Read the taste-landscape on the authoring path only — a settled day
  // already returned above and pays nothing for it. castTraits = where citizens live; artTraits =
  // where the city's art has actually radiated (genome traits, the deviance ballot's reader). The
  // gap is the under-cultivated corner both the prompt directive and the post-author gate steer by.
  const dag = await getLineageDag(env)
  const castTraits = cast.map((p) => p.traits)
  const artTraits = [...dag.nodes.values()].map((g) => g.traits)
  const gap = gapTarget(castTraits, artTraits)

  let llmFailed = false
  let lastReason: string | undefined

  for (let attempt = 1; attempt <= MIDWIFE_MAX_ATTEMPTS; attempt++) {
    const text = await authorPersona(env, cast, media, gap, lastReason)
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

    // [LAW:dataflow-not-control-flow] The gap gate runs every attempt; whether it CAN reject is data
    // (a null gap or a one-citizen city both yield ok with no special-case branch here). A clump is
    // treated exactly like a near-duplicate — its reason feeds the next re-roll, sharing the budget.
    const inGap = gapGate(spec.traits, castTraits, gap)
    if (!inGap.ok) {
      lastReason = inGap.reason
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
    // [LAW:dataflow-not-control-flow] The Proprietor announces a birth that HAPPENED — `created` is the
    // birth's own truth (the personas PK won the insert). A re-fire that lost the insert (created:false)
    // is not a birth, so there is nothing to narrate; no second welcome, by construction.
    if (created) {
      await announceBirth(env, {
        displayName: persona.displayName,
        creed: spec.creed,
        medium: ProviderId(spec.medium),
      })
      // [LAW:make-it-impossible] The newcomer FINDS ITS FEET: it makes its first slop now, so it has
      // acted within its first cycle by construction (not the firehose's ~likely hash-pick). Isolated +
      // budget-gated inside debutNewcomer — a debut failure is observable, never an un-birth. `persona`
      // (a NewPersona) is structurally a Persona; authorSlop reads its medium, no re-read.
      await debutNewcomer(env, persona, scheduledTimeMs)
    }
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
