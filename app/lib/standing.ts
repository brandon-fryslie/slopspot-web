// [LAW:types-are-the-program] A citizen's STANDING is an ARC, not a level — the
// three states the roll call dramatizes ("a maker on a hot streak ascends; one whose
// work stops landing fades", the-roll-call.md "Standing & the citizen lifecycle").
// It is DERIVED, never a stored mutable status that drifts — the HARD LOCK of
// slopspot-roll-call-47p.5. That same line draws the boundary to the-civilization.md
// System IV: the persistent standing STATE LAYER (and retirement/eulogy, which need
// stored lifecycle state) is System IV's; this is its read-time, no-schema predecessor.
//
// [LAW:effects-at-boundaries] This module is the pure core — the standing function and
// its display vocabulary, no I/O. The reception a citizen is judged on is gathered at
// the storage boundary (app/db/standing.ts) and handed here as a finished Momentum.

export type Standing = 'ascendant' | 'steady' | 'fading'

// [LAW:types-are-the-program] The two adjacent equal windows a citizen's reception is
// read into — `recent` (the latest window) against `prior` (the window before it).
// Standing is the SHAPE of the change between them, so the bare level is never enough:
// a citizen who has always been loud is STEADY, not ASCENDANT. The currency is the
// guild's — net votes RECEIVED for makers/scavengers, votes CAST for critics — but the
// comparison is intra-citizen (a citizen against its OWN past), so the differing
// currency never crosses this seam. standingOf sees only the pair and maps the same arc
// the same way, whatever deed produced it. [LAW:one-type-per-behavior]
export type Momentum = { recent: number; prior: number }

// The absolute reception swing required to read as an arc, regardless of the citizen's
// scale — the floor that keeps one or two stray votes from manufacturing drama out of a
// quiet citizen (or a blank-slate newcomer with a prior of zero). Below it the honest
// standing is STEADY.
const MIN_DELTA = 3

// For a citizen already operating at scale, the swing must additionally beat this
// fraction of their in-play volume — so a heavyweight whose reception merely wobbles by
// a few votes stays STEADY, while a proportional collapse or surge reads as the arc it
// is. The effective bar is whichever of the two (absolute floor, proportional band) is
// larger, so the test is symmetric for ascendant and fading.
const ARC_BAND = 0.25

// [LAW:dataflow-not-control-flow] The arc is read off two values with no branch on
// "does this citizen have enough signal" — the threshold folds the floor and the band
// into one number, so a quiet or blank-slate citizen lands in STEADY because its delta
// cannot clear the floor, not because a guard skipped it. The only branching is the
// inherent three-way classification of the result.
export function standingOf(m: Momentum): Standing {
  const delta = m.recent - m.prior
  const scale = Math.max(Math.abs(m.recent), Math.abs(m.prior))
  const threshold = Math.max(MIN_DELTA, ARC_BAND * scale)
  if (delta > threshold) return 'ascendant'
  if (delta < -threshold) return 'fading'
  return 'steady'
}

// The placard vocabulary for a standing — the mark (an arrow that reads the arc at a
// glance) and the word. [LAW:one-source-of-truth] the one place a Standing becomes
// human-facing text; both Cast surfaces render from this, so the roster chip and the
// shrine line can never disagree on what "fading" looks like.
export type StandingDisplay = { mark: string; label: string }

// [LAW:types-are-the-program] Exhaustive over the closed union — a new standing forces
// its vocabulary here before it compiles.
export function standingDisplay(standing: Standing): StandingDisplay {
  switch (standing) {
    case 'ascendant':
      return { mark: '▲', label: 'ascendant' }
    case 'steady':
      return { mark: '·', label: 'steady' }
    case 'fading':
      return { mark: '▽', label: 'fading' }
    default: {
      const _exhaustive: never = standing
      return _exhaustive
    }
  }
}
