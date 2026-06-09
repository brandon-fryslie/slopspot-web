// [LAW:single-enforcer] The Grace pass — the one place the Patronage's citizen→human edge is chosen and
// recorded (slopspot-patronage-ts7.8). A daily cron (workers/app.ts) calls runGrace once per UTC day: it
// reads the engagement corpus (db/grace), folds it with the pure chooser (lib/grace) at the day's tunable
// rarity, and records the result through the graces single writer. The dawning — the citizen UTTERING its
// choice to the city in third person — is the NEXT child (ts7.9); this pass only records the edge as fact.
//
// [LAW:one-way-deps] grace(agents) → agents/persona (the rarity config read), db/grace (corpus + record),
// lib/grace (the fold), observability/metrics. It NEVER reaches the backings table; the chooser cannot,
// because GraceCorpus has no field for one. This module is the orchestration tier, the way agents/rite.ts
// orchestrates the Rite over the db/crowns I/O boundary.

import { getPersonaByHandle } from '~/agents/persona'
import { readGraceCorpus, readGraceReveal, recordGrace } from '~/db/grace'
import { recordUtterance } from '~/db/utterances'
import { chooseGrace, DEFAULT_GRACE_FALL_RATE, type GraceEdge } from '~/lib/grace'
import { utter, type PersonaRef } from '~/lib/voice'
import { emit } from '~/observability/metrics'

// The host whose persona config holds the live rarity knob. The Proprietor presides over the city's
// ceremonies (drizzle/0019_proprietor_host); graceFallRate lives on his config_json so the CD tunes how
// often grace falls via SQL with no redeploy — the same SQL-tunable path persona prompts/bias use, and
// (unlike generator config) host config is parsed by no .strict() schema, so the key adds cleanly.
const PROPRIETOR_HANDLE = 'the-proprietor'

// The UTC calendar day the grace fills, and the UNIQUE slot it occupies — same shape as the Rite's
// rite_day and the Birth's per-day id, so the daily pass is idempotent BY CONSTRUCTION (a second fire of
// the same day collides on graces.grace_day). [LAW:no-ambient-temporal-coupling] derived from the
// scheduledTime threaded in, never the wall clock.
export function graceDayKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// [LAW:dataflow-not-control-flow] Resolve the live rarity VALUE — the Proprietor's config_json.graceFallRate
// when it is a valid [0,1] number, else the code default. Not a mode: the chooser's shape is identical at
// any rate; only this value changes how often grace falls. A missing host, a missing/garbage key, or an
// out-of-range value all degrade to the default by data — never a throw that would abort the ceremony.
async function graceFallRate(env: Env): Promise<number> {
  const proprietor = await getPersonaByHandle(env, PROPRIETOR_HANDLE)
  const raw = proprietor?.config.graceFallRate
  return typeof raw === 'number' && raw >= 0 && raw <= 1 ? raw : DEFAULT_GRACE_FALL_RATE
}

// [LAW:types-are-the-program] The pass's outcomes, surfaced so the cron and tests read the result without
// re-querying: a grace fell (a citizen chose a human just now), the day already settled one (idempotent
// re-fire), grace was withheld this pass (the rarity gate — the common case, grace is rare), or the corpus
// is barren (no human has yet engaged a citizen's slop, so there is nothing to choose from).
export type GraceResult =
  | { kind: 'fell'; edge: GraceEdge }
  | { kind: 'already-fell' }
  | { kind: 'withheld' }
  | { kind: 'barren' }

// [LAW:single-enforcer] The one daily ceremony that may let grace fall. Deterministic in its day: the same
// scheduledTime hashes to the same fall/withhold decision and the same edge pick (lib/grace), so a re-fire
// is reproducible AND idempotent (the UNIQUE grace_day discards a second record). The corpus read decides
// barren-vs-withheld when no edge is chosen — both are honest, observable no-ops, never a silent miss.
export async function runGrace(env: Env, scheduledTimeMs: number): Promise<GraceResult> {
  const corpus = await readGraceCorpus(env)
  const rarity = await graceFallRate(env)
  const edge = chooseGrace(corpus, scheduledTimeMs, rarity)

  if (edge === null) {
    // [LAW:dataflow-not-control-flow] barren vs withheld is a property of the DATA (was the corpus empty?),
    // not of why the fold returned null — the two agree because chooseGrace returns null for an empty corpus.
    const kind = corpus.edges.length === 0 ? 'barren' : 'withheld'
    emit('slopspot.grace.outcome', { outcome: kind }, 1)
    return { kind }
  }

  const graceDay = graceDayKey(scheduledTimeMs)
  const res = await recordGrace(env, {
    citizen: edge.citizen,
    human: edge.human,
    postId: edge.postId,
    graceDay,
  })
  emit('slopspot.grace.outcome', { outcome: res.recorded ? 'fell' : 'already-fell' }, 1)
  if (res.recorded) {
    // The recorded fact only — never a notification TO the human. The reveal below is the citizen's own
    // third-person line to the city; the human is still never told.
    console.log('[grace] fell', { citizen: edge.citizen, human: edge.human, postId: edge.postId, graceDay })
    // [LAW:no-ambient-temporal-coupling] The reveal NARRATES a choice that is now recorded — it runs AFTER
    // recordGrace, and only on a fresh record (a settled-day re-fire is `already-fell` and never reaches
    // here), riding the grace's OWN idempotency (UNIQUE grace_day) the way announceBirth rides the personas
    // PK. revealGrace is self-isolated (its own catch), so a reveal failure never un-records this grace.
    await revealGrace(env, edge)
    return { kind: 'fell', edge }
  }
  return { kind: 'already-fell' }
}

// [LAW:single-enforcer][LAW:no-silent-fallbacks] The Third-Person Reveal (slopspot-patronage-ts7.9). The
// choosing citizen narrates its grace to the CITY through the ONE Voice mechanism (utter → recordUtterance),
// the same shape announceBirth uses for the Birth Rite. Voice NARRATES a choice that ALREADY happened: this
// runs only AFTER recordGrace, so the line is the consequence of a recorded grace, never its cause.
//
// ISOLATED + TOTAL: the grace (the graces row) is PRIMARY TRUTH; this line is best-effort NARRATION. A
// failure here (the maker unseated, a D1 write error) must NOT un-record a grace, so it is caught and
// surfaced on its OWN signal (slopspot.grace.reveal + a loud log), never propagated as a grace failure.
//
// THE DAWNING is type-guaranteed upstream, not by this body: the GraceChoice target (lib/voice) carries no
// human and readGraceReveal selects none, so the recorded line CANNOT name the chosen — a tourist reading the
// city cannot tell who was chosen, and the chosen is never addressed. Exported (not inlined) so the gate is
// verifiable without the rarity/record path: given a recorded edge, this records exactly one third-person,
// human-free line.
export async function revealGrace(env: Env, edge: GraceEdge): Promise<void> {
  try {
    const reveal = await readGraceReveal(env, edge)
    if (reveal === null) {
      // [LAW:no-defensive-null-guards] Not a silent skip: a GENUINE storage absence (the made-thing or its
      // maker vanished between record and reveal) leaves no subject to ground a line. Surfaced on its own
      // outcome and logged loud; the grace stays recorded. The else is meaningful — this is real optionality.
      emit('slopspot.grace.reveal', { outcome: 'absent' }, 1)
      console.warn('[grace] reveal absent — grace recorded, but its made-thing/maker is gone; nothing to voice', {
        citizen: edge.citizen,
        postId: edge.postId,
      })
      return
    }
    // The speaker is the choosing citizen itself — a base PersonaRef (grace does not re-voice, so empty caps).
    const speaker: PersonaRef = { handle: reveal.citizen, displayName: reveal.makerName }
    const utterance = await utter(speaker, 'grace', { slop: reveal.slop }, {})
    await recordUtterance(env, {
      speaker: reveal.citizen,
      occasion: 'grace',
      targetPostId: reveal.slop.postId,
      utterance,
    })
    emit('slopspot.grace.reveal', { outcome: utterance.kind }, 1)
  } catch (err) {
    emit('slopspot.grace.reveal', { outcome: 'failed' }, 1)
    console.error('[grace] reveal failed — grace recorded but unspoken (observable, not an un-grace)', {
      citizen: edge.citizen,
      err,
    })
  }
}
