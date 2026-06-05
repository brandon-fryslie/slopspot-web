// [LAW:one-source-of-truth] Character-with-a-past as a PURE projection: a citizen's voice register is
// read from its ACCRETED effective traits — its innate genome sensibility (base) TINTED by what it has
// actually blessed and buried over time — never a stored personality blob. It is the SAME TraitVector
// `lib/register`'s traitBias already speaks; .3 only makes that vector HISTORICAL. The Gremlin that has
// buried a thousand earnest forests drifts toward the cursed/mask poles and so SPEAKS harsher — its
// record becomes who it is. (slopspot-voice-w2v.3)
//
// [LAW:one-way-deps] Pure leaf: base, the acts, `now`, and the half-life all arrive from the caller;
// the time decay is the SHARED recencyWeight leaf at .3's own rate (no parallel decay to reconcile).
// The db reader (app/db/character.ts) fetches the acts and supplies `now`; this file never touches D1
// or the clock, so determinism stays the caller's.

import type { TraitVector, VoteValue } from '~/lib/domain'
import { recencyWeight } from '~/lib/recency'

// One judged slop in a citizen's record: the genome vector it acted on, the disposition (+1 bless = pull
// the citizen's taste TOWARD that vector, −1 bury = push AWAY), and when. found/upload slops carry no
// genome vector, so they are never acts — the reader's join excludes them by construction, not a filter.
export type CharacterAct = {
  readonly traits: TraitVector
  readonly value: VoteValue
  readonly createdAt: Date
}

// [LAW:types-are-the-program] How far a fully-consistent history can pull an axis off its base. The pull
// term is a weighted mean of signed half-unit offsets, so its magnitude is at most 0.5; at 0.6 a record
// that leans entirely one way on an axis shifts it at most ~0.3, leaving the base sensibility plainly
// recognizable — accretion TINTS, it never overwrites. A tunable edge constant; set conservative, raise
// once the rendered register shift is measured (the same set-after-you-can-measure discipline as genome
// .7's budget).
export const ACCRETION_WEIGHT = 0.6

// [LAW:types-are-the-program] effective traits stay a TraitVector — every axis in [0,1]. A pull that
// would carry an axis past a pole saturates at it rather than wrapping or escaping the legal range.
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

// [LAW:single-enforcer] The ONE accretion: base sensibility + the recency-weighted pull of the record.
// Per axis the pull is the weighted mean (over acts) of value·(actTrait − 0.5) — a bless pulls toward
// the slop's pole, a bury pushes to the opposite, and recent acts outweigh old ones via recencyWeight.
// effective = clamp01(base + ACCRETION_WEIGHT·pull). Deterministic and total — the stanceOf-analog for
// the voice register.
export function accreteCharacter(
  base: TraitVector,
  acts: readonly CharacterAct[],
  now: Date,
  halfLifeMs: number,
): TraitVector {
  const weights = acts.map((a) => recencyWeight(now.getTime() - a.createdAt.getTime(), halfLifeMs))
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)

  // [LAW:dataflow-not-control-flow] The weighted-mean pull per axis. An empty (or fully decayed) record
  // has totalWeight 0 → the mean is the additive identity 0 → effective === base: a citizen with no past
  // speaks in its innate register. This is the empty aggregate's identity value, NOT a branch that skips
  // work — every axis runs the same projection whether or not the history exists.
  const pull = (axis: keyof TraitVector): number => {
    const weighted = acts.reduce((sum, a, i) => sum + weights[i] * a.value * (a.traits[axis] - 0.5), 0)
    return totalWeight === 0 ? 0 : weighted / totalWeight
  }

  const tint = (axis: keyof TraitVector): number => clamp01(base[axis] + ACCRETION_WEIGHT * pull(axis))

  return {
    austerity: tint('austerity'),
    curse: tint('curse'),
    density: tint('density'),
    earnestness: tint('earnestness'),
  }
}
