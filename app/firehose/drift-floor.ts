// [LAW:single-enforcer] The drift floor — the city's ONE monoculture pressure-release.
// "Selection without mutation pressure is a monoculture, and monoculture is the one death
// this site cannot die" (the-procession.md Act 0, the Year of the Fox). The genome
// SUCCEEDS: winners win votes, the firehose breeds winners, and the gene pool converges on
// a single phenotype family (three foxes in one screenful). This module owns the single
// measure that bounds that convergence — a phenotype family's SHARE of the recent pool —
// and the two transforms the firehose applies to it:
//   • `driftFloor` — a per-candidate weight multiplier the CHOOSER folds into its founder
//     draw (rule R7), so a fresh fire avoids the over-represented family.
//   • `monoculturePressure` — a scalar the BREEDER (selectReproduction) folds into its
//     founder-injection rate, so a converging city breeds less and founds fresh blood more.
// They are complements about one number, so they can never disagree about "too much."
//
// [LAW:one-source-of-truth] DRIFT_FLOOR_CAP and the share→weight ramp live HERE. The chooser
// imports `driftFloor`; the breeder is fed `monoculturePressure`. No second copy of "what
// share is too much" anywhere — `monoculturePressure` is literally `1 - driftFloor(dominant)`,
// so the relax point and the cap are stated once.
//
// [LAW:one-way-deps] Pure leaf over the RecentRecipe read-shape — no env, no clock, no I/O.
// Same recent → same pressure, every time.

import type { RecentRecipe } from '~/db/recent'
import type { PostId } from '~/lib/domain'

// [LAW:no-mode-explosion] The single surfaced knob: no phenotype family may exceed this
// share of the recent pool. Above it, a family's founder-draw weight is 0 and the breeder's
// novelty injection is full. With ~14 style families and ~21 animals, the uniform share sits
// far below this — so a healthy, varied pool never feels the floor. Tunable; never a flag.
export const DRIFT_FLOOR_CAP = 0.34

// Full weight until a family reaches half the cap, then a linear ramp to 0 at the cap. Below
// the relax point the floor is a strict no-op, so a varied pool draws exactly as it did
// before R7 existed.
const RELAX_FRACTION = 0.5
const RELAX = DRIFT_FLOOR_CAP * RELAX_FRACTION

// [LAW:dataflow-not-control-flow] The drift floor as a continuous weight multiplier in [0,1]:
// 1.0 while a family's share is healthy, ramping to 0 as the share climbs to the cap. The
// ternaries CONSTRUCT the multiplier (like breed.ts's clamp01) — they compute a value, never
// skip an operation. An empty window (total 0) yields 1.0: the no-op that makes bootstrap and
// steady-state one code path, the same way an empty `recent` degrades the chooser's R-rules.
export function driftFloor(count: number, total: number): number {
  if (total === 0) return 1
  const share = count / total
  return share <= RELAX
    ? 1
    : share >= DRIFT_FLOOR_CAP
      ? 0
      : 1 - (share - RELAX) / (DRIFT_FLOOR_CAP - RELAX)
}

// [LAW:types-are-the-program] The convergence READING: WHICH phenotype family is over-represented in
// the recent pool, how many of it there are, and a representative slop (the newest member). This is the
// ONE source of "what is the monoculture" — the scalar `monoculturePressure` (the breeder lever) is a
// projection of `count`, and the Noticing (the city remarking on the sameness, slopspot-genome-brs) reads
// `label` + `representative`. The breeder valve and the city's voice therefore CANNOT disagree about which
// family is too much, because both read this one reading.
//
// `axis` is which phenotype gene converged — the visible animal slot (the "fox") or the deeper style family;
// `label` is that family's value (a plain recipe string — NEVER an era name: the city notices the foxes, it
// does not declare a "Year of the Fox"; doctrine/on-eras.md). `representative` is a real recent member the
// Noticing links to, so a murmur about the sameness points at an actual slop, not an abstraction.
export interface DominantFamily {
  readonly axis: 'animal' | 'style'
  readonly label: string
  readonly count: number
  readonly representative: PostId
}

// [LAW:dataflow-not-control-flow] The breeder's novelty pressure — the EXACT complement of
// the floor for the dominant family: 0 while the pool is varied, ramping to 1 as the most-
// represented phenotype family approaches the cap. selectReproduction folds this into the
// founder-injection weight, so the negative-feedback valve holds the dominant share at the
// cap: as the share rises the city founds more (fresh, floored, non-dominant) and breeds
// less, the window slides, and the pressure relaxes.
//
// A projection of `dominantFamily`: an empty/family-less window has no dominant family → no pressure (0,
// the same no-op the floor's empty-window arm gives). One reading, two readers.
export function monoculturePressure(recent: readonly RecentRecipe[]): number {
  const dominant = dominantFamily(recent)
  return dominant === null ? 0 : 1 - driftFloor(dominant.count, recent.length)
}

// [LAW:single-enforcer] The dominant phenotype family across BOTH convergence axes — the animal slot value
// (the visible "fox") and the style family (the deepest gene, `genes.species`). Returns the single most-
// represented family of the two; a tie prefers the ANIMAL axis (the visible convergence the doctrine names).
// Null ONLY when the window is empty (a bootstrap pool with nothing generated yet) — every RecentRecipe
// carries a styleFamily, so any non-empty window has a most-represented family even when that share is a
// trivial 1/n (then `monoculturePressure` projects it to 0 and the Noticing's draw stays quiet). The null is
// a genuine "nothing has converged" the readers handle as a value, never a thrown guard.
//
// The denominator the share is read against is the WHOLE window ("share of the recent pool" / the screenful);
// a row with no animal slot contributes to no family's numerator, so a fox is a smaller share of a mixed
// screenful — exactly the "3 foxes in one screenful" reading. The representative is the family's NEWEST
// member (recent is ordered newest-first, so the first match), deterministic on the same recent.
export function dominantFamily(recent: readonly RecentRecipe[]): DominantFamily | null {
  const animal = dominantOf(recent, 'animal', (r) => r.slots['animal'])
  const style = dominantOf(recent, 'style', (r) => r.styleFamily)
  if (animal === null) return style
  if (style === null) return animal
  // Strictly-greater style wins; an equal count falls to the animal axis.
  return style.count > animal.count ? style : animal
}

// The most-represented family along one projected axis, with its count and newest representative. A row
// whose projection is undefined (a subject template with no animal slot) is simply not counted for any
// family, so it dilutes every family's share rather than inflating one.
function dominantOf(
  recent: readonly RecentRecipe[],
  axis: DominantFamily['axis'],
  project: (r: RecentRecipe) => string | undefined,
): DominantFamily | null {
  // One entry per family: its running count and its NEWEST representative. recent is newest-first, so the
  // first row of a family is its newest member — set the representative once, never overwrite it.
  const families = new Map<string, { count: number; representative: PostId }>()
  for (const r of recent) {
    const key = project(r)
    if (key === undefined) continue
    const seen = families.get(key)
    if (seen === undefined) families.set(key, { count: 1, representative: r.postId })
    else seen.count++
  }
  let best: DominantFamily | null = null
  for (const [label, { count, representative }] of families) {
    if (best === null || count > best.count) best = { axis, label, count, representative }
  }
  return best
}
