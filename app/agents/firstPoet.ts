// [LAW:single-enforcer] The First-Poet Rite — the city's once-ever decree that marks its first poet. A
// sibling of the Daily Rite (rite.ts): the same act (the Proprietor reads state, speaks a decree, persists
// it), but an HONOR (a citizen marked for a first that happens once in the city's life) rather than a crown
// (a post won by the day's votes, nightly). It owns no "who is the poet" math (persona.ts derives that) and
// no decree text (voice.ts composes it) — here is the I/O, the persistence, and the metric.
//
// [LAW:dataflow-not-control-flow] The decree is derived from STATE, never the birth EVENT. The cron calls
// this UNCONDITIONALLY every daily tick (beside the birth, not inside it): the operation always runs, and
// the DATA decides — "a verse-citizen exists AND no first-poet honor recorded → decree the EARLIEST verse-
// citizen by created_at." This makes the race impossible (a birth that creates the first poet is decreed on
// the same tick, reading the row the birth just wrote) AND catches the first poet EVEN IF it was born before
// this ceremony existed (the next tick reads the pre-existing citizen and decrees it). 'First poet' is never
// a seeded flag; it is a pure function of the cast's state.
//
// [LAW:one-way-deps] firstPoet → persona (who), rite (the Proprietor's voice ref), voice (compose), honors
// (persist). One-way: none of those reach back here.

import { earliestVerseCitizen } from '~/agents/persona'
import { proprietorRef } from '~/agents/rite'
import { honorOf, recordHonor } from '~/db/honors'
import type { AgentId } from '~/lib/domain'
import { utter, type Utterance } from '~/lib/voice'
import { emit } from '~/observability/metrics'

// The honor's kind — its PRIMARY KEY in the honors table, the identity that makes it fire once ever. One
// constant so the writer and every reader (the cast-card mark) name the same honor.
export const FIRST_POET_KIND = 'first-poet'

// The poet's birth day, formatted for the permanent mark ("the city's first poet, born [date]"). UTC, the
// same calendar the births and the rite key by, so the marked date matches the day the citizen was born.
function bornOnDay(ms: number): string {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// [LAW:types-are-the-program] The rite's three real outcomes, surfaced so the cron and tests read the result
// without re-querying: the first poet was decreed now, the kind was already decreed (idempotent re-fire), or
// there is no verse-citizen yet (the honest no-poet state — the city has not written yet).
export type FirstPoetResult =
  | { kind: 'decreed'; agentId: AgentId; decree: Utterance }
  | { kind: 'already-decreed'; agentId: AgentId }
  | { kind: 'no-poet' }

// [LAW:single-enforcer] The one place the first-poet honor is pronounced and recorded. Deterministic in its
// state: already-honored → no-op (no re-decree, no second LLM cost when the voice is LLM-backed later); no
// verse-citizen → no-op; otherwise decree the EARLIEST verse-citizen and record it. recordHonor's PK(kind)
// + onConflictDoNothing makes a concurrent fire converge on the one row, so the result is authoritative even
// under a race.
export async function maybeDecreeFirstPoet(env: Env): Promise<FirstPoetResult> {
  // [LAW:dataflow-not-control-flow] The kind is honored or it isn't — a real data state. An honored kind
  // returns its recorded poet without re-deriving or re-voicing (the fires-once-ever short-circuit, mirroring
  // the rite's settled-day check).
  const settled = await honorOf(env, FIRST_POET_KIND)
  if (settled !== null) {
    emit('slopspot.firstpoet.decree', { outcome: 'already-decreed' }, 1)
    return { kind: 'already-decreed', agentId: settled.agentId }
  }

  // The city's first poet by state — or none yet. A null poet is the honest "the city has not written"
  // state, handled as a real outcome, not a skipped branch.
  const poet = await earliestVerseCitizen(env)
  if (poet === null) {
    emit('slopspot.firstpoet.decree', { outcome: 'no-poet' }, 1)
    return { kind: 'no-poet' }
  }

  const proprietor = await proprietorRef(env)
  const decree = await utter(
    proprietor,
    'first-poet',
    { displayName: poet.displayName, creed: poet.creed, bornOn: bornOnDay(poet.bornAtMs) },
    {},
  )

  const result = await recordHonor(env, { kind: FIRST_POET_KIND, agentId: poet.agentId, decree })

  // [LAW:no-silent-fallbacks] If a concurrent fire recorded the honor between the settled-check and this
  // insert, recordHonor hands back the honor that IS there; report THAT poet, never re-decree.
  if (!result.recorded) {
    emit('slopspot.firstpoet.decree', { outcome: 'already-decreed' }, 1)
    return { kind: 'already-decreed', agentId: result.existing.agentId }
  }

  emit('slopspot.firstpoet.decree', { outcome: 'decreed' }, 1)
  console.log('[first-poet] decreed', { agentId: poet.agentId, displayName: poet.displayName, bornOn: bornOnDay(poet.bornAtMs) })
  return { kind: 'decreed', agentId: poet.agentId, decree }
}
