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

// [LAW:dataflow-not-control-flow] The breeder's novelty pressure — the EXACT complement of
// the floor for the dominant family: 0 while the pool is varied, ramping to 1 as the most-
// represented phenotype family approaches the cap. selectReproduction folds this into the
// founder-injection weight, so the negative-feedback valve holds the dominant share at the
// cap: as the share rises the city founds more (fresh, floored, non-dominant) and breeds
// less, the window slides, and the pressure relaxes.
//
// Measured over the phenotype axes the convergence manifests in — the animal slot value (the
// visible "fox") and the style family (the deepest gene, `genes.species`). The denominator is
// the WHOLE window ("share of the recent pool" / the screenful), matching the chooser's floor:
// a row with no animal slot contributes to the denominator but to no family's numerator, so a
// fox is a smaller share of a mixed screenful — exactly the "3 foxes in one screenful" reading.
export function monoculturePressure(recent: readonly RecentRecipe[]): number {
  if (recent.length === 0) return 0
  const dominant = Math.max(
    dominantCount(recent, (r) => r.slots['animal']),
    dominantCount(recent, (r) => r.styleFamily),
  )
  return 1 - driftFloor(dominant, recent.length)
}

// The largest count any single projected phenotype family holds in the window. A row whose
// projection is undefined (a subject template with no animal slot) is simply not counted for
// any family, so it dilutes every family's share rather than inflating one.
function dominantCount(
  recent: readonly RecentRecipe[],
  project: (r: RecentRecipe) => string | undefined,
): number {
  const counts = new Map<string, number>()
  for (const r of recent) {
    const key = project(r)
    if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let max = 0
  for (const c of counts.values()) if (c > max) max = c
  return max
}
