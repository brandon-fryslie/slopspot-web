// [LAW:single-enforcer] The Daily Rite's orchestrator — the one entry the 3am cron
// calls to crown the city's own. It reads the votes that already exist, runs the
// pure election (app/lib/rite.ts), voices the Proprietor's decree through utter()
// (app/lib/voice.ts), and either persists a crown or honours the Unmoved Day. It
// owns no election math and no voice text — those are pure elsewhere; here is the
// I/O, the persistence, and the metric.
//
// [LAW:dataflow-not-control-flow] No new voting mechanic. The ballot is
// gatherCandidates' read of SUM(votes)/blessings/burials — the same votes the feed
// ranks by. The day's lens (by UTC weekday) and the candidates (data) decide the
// saint; the Unmoved Day is a real handled outcome, not a skipped branch.

import { getPersonaByHandle } from '~/agents/persona'
import { gatherCandidates, recordCrowning } from '~/db/crowns'
import type { PostId } from '~/lib/domain'
import { emit } from '~/observability/metrics'
import {
  CROWN_INTENSITY_THRESHOLD,
  elect,
  riteForDay,
  type RiteLens,
} from '~/lib/rite'
import { utter, type PersonaRef, type Utterance } from '~/lib/voice'

// The Proprietor is the city's host and the Rite's crowner; his handle is stable
// (drizzle/0019_proprietor_host). He hosts every rite — the presiding citizen
// supplies the taste, but the decree is always in his voice.
const PROPRIETOR_HANDLE = 'the-proprietor'

// [LAW:types-are-the-program] The rite's two real outcomes, surfaced so callers
// (and tests) read the result without re-querying: a crowning (with the decree and
// whether this run was the one that recorded it), or an Unmoved Day (with the
// Proprietor's voiced line — the honest empty altar).
export type RiteResult =
  | { kind: 'crowned'; postId: PostId; lens: RiteLens; decree: Utterance; recorded: boolean }
  | { kind: 'unmoved'; lens: RiteLens; decree: Utterance }

// The liturgical day key (UTC) — the crown's permanent date and the UNIQUE slot the
// rite fills once. 3am fires on a UTC cron, so the UTC calendar date is the day.
function utcRiteDay(ms: number): string {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// [LAW:no-silent-fallbacks] The Rite cannot speak without its host. A missing
// Proprietor row is a real misconfiguration (he is seeded by migration), so fail
// loud rather than crown in some anonymous default voice.
async function proprietorRef(env: Env): Promise<PersonaRef> {
  const proprietor = await getPersonaByHandle(env, PROPRIETOR_HANDLE)
  if (proprietor === null) {
    throw new Error('rite: the Proprietor is not seated — cannot pronounce a decree')
  }
  return { handle: proprietor.agentId, displayName: proprietor.displayName }
}

// [LAW:single-enforcer] The one nightly ceremony. Folded onto the existing 3am cron
// (workers/app.ts) beside bank-gen and the portrait pass — one scheduler, no
// parallel cron. Deterministic in its inputs: same scheduledTime + same votes →
// same outcome.
export async function runRite(env: Env, scheduledTimeMs: number): Promise<RiteResult> {
  const def = riteForDay(new Date(scheduledTimeMs).getUTCDay())
  const riteDay = utcRiteDay(scheduledTimeMs)
  const speaker = await proprietorRef(env)

  const candidates = await gatherCandidates(env)
  const election = elect(def.pole, candidates, CROWN_INTENSITY_THRESHOLD)

  if (election.kind === 'unmoved') {
    // [LAW:no-silent-fallbacks] The Unmoved Day — crown nothing, and the Proprietor
    // says so, in voice. An honest empty altar, recorded as a metric and the decree
    // line; never a crowned mid filling the slot.
    const decree = utter(speaker, 'decree', { kind: 'unmoved', riteTitle: def.title })
    emit('slopspot.rite.outcome', { lens: def.lens, outcome: 'unmoved' }, 1)
    console.log('[rite] unmoved', { riteDay, lens: def.lens, decree })
    return { kind: 'unmoved', lens: def.lens, decree }
  }

  const winner = candidates.find((c) => c.postId === election.postId)
  if (winner === undefined) {
    // elect() only ever returns a postId it read from `candidates`, so this is a
    // can't-happen invariant — fail loud rather than crown a phantom post.
    throw new Error(`rite: elected post ${election.postId} is absent from candidates`)
  }

  const decree = utter(speaker, 'decree', {
    kind: 'crowned',
    crowned: { riteTitle: def.title, postId: winner.postId, placard: winner.placard },
  })

  const result = await recordCrowning(env, {
    postId: winner.postId,
    riteDay,
    lens: def.lens,
    presiding: def.presiding,
    decree,
  })

  emit(
    'slopspot.rite.outcome',
    { lens: def.lens, outcome: result.recorded ? 'crowned' : 'already-crowned' },
    1,
  )
  return { kind: 'crowned', postId: winner.postId, lens: def.lens, decree, recorded: result.recorded }
}
