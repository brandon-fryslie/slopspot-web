// [LAW:effects-at-boundaries] The PURE core of the breadth measurement: given trait vectors, it
// computes how WIDE the distribution is — no D1, no clock, no emit. The reader (app/db/trait-spread)
// supplies the rows; the ceremony (app/agents/traitSpread) performs the emit. This module only
// computes, so the whole breadth-proof can be reasoned about and tested in isolation.
//
// THE THESIS IT MAKES MEASURABLE (slopspot-genome-1l7): RANGE is the product. genome-3un gave the
// three GENERATORS spanning trait regions (GutterMonk owns the austere/sparse VOID pole). But
// generation breadth is only half — the FEED is what gets seen, and if selection (votes → score)
// favours one pole it BURIES the range even though the makers have it. This module turns
// "monoculture broke" into a number: the dispersion of what is GENERATED vs the dispersion of what
// SURVIVES (rises to the top by score). Healthy = both wide. Selection eating the range = generated
// wide, surviving narrow — and `isCollapsing` names that, loud, with the numbers behind it.

import type { TraitVector } from '~/lib/domain'
import { TRAIT_AXES, type TraitAxis } from '~/lib/traits'

// A generation post reduced to the two facts the breadth question needs: the heritable trait vector
// the maker stamped, and the materialized score the feed ranks it by (posts.score, the 0028 cache —
// READ, never re-derived). The reader produces these; everything below is a pure function of them.
export type ScoredTraits = {
  traits: TraitVector
  score: number
}

// [LAW:types-are-the-program] The two cohorts the breadth question compares. `generated` = every
// generation post (what the makers produced); `surviving` = the top-ranked subset (what selection
// lets rise). A closed union so a metric label or report key cannot name a third cohort.
export type TraitCohort = 'generated' | 'surviving'

// Per-axis dispersion (population standard deviation, in the axis's own [0,1] units). A wide spread
// means the cohort covers the axis; a spread near 0 means it has collapsed to a single value.
export type AxisSpread = Record<TraitAxis, number>

// The full breadth picture: how many posts fell in each cohort, the per-axis spread of each, and the
// retention ratio (surviving spread ÷ generated spread) per axis — <1 means selection narrowed that
// axis, ≈1 means selection preserved its range.
export type SpreadReport = {
  counts: Record<TraitCohort, number>
  spread: Record<TraitCohort, AxisSpread>
  retention: AxisSpread
}

// The fraction of posts (ranked by score, descending) counted as "surviving" — the top portion that
// genuinely rises to feed visibility. A proxy for "what gets seen"; one third is the top-ranked slice
// "survives selection" points at (not the mere upper half), tunable as the feed's window evolves.
export const SURVIVING_FRACTION = 1 / 3

// The axes GutterMonk's void pole spans (austere + sparse). Selection collapse is judged on THESE —
// the range genome-3un just created and this ticket is protecting — not on curse/earnestness.
export const VOID_AXES: readonly TraitAxis[] = ['austerity', 'density']

// Below this retention ratio on a void axis, the surviving cohort holds less than this share of the
// makers' dispersion — i.e. selection has materially narrowed the range. 0.5 = "the feed shows less
// than half the void-range the makers produced": a clear, defensible line, tunable as data grows.
export const COLLAPSE_RATIO = 0.5

const ZERO_SPREAD: AxisSpread = { austerity: 0, curse: 0, density: 0, earnestness: 0 }

// Population standard deviation per axis. An empty cohort has no dispersion — it reduces to 0 the way
// an empty collection reduces to a no-op (NOT a guarded special case: there is simply no deviation to
// measure). [LAW:dataflow-not-control-flow]
export function axisSpread(traits: readonly TraitVector[]): AxisSpread {
  const n = traits.length
  if (n === 0) return { ...ZERO_SPREAD }
  const out = { ...ZERO_SPREAD }
  for (const axis of TRAIT_AXES) {
    const mean = traits.reduce((s, t) => s + t[axis], 0) / n
    const variance = traits.reduce((s, t) => s + (t[axis] - mean) ** 2, 0) / n
    out[axis] = Math.sqrt(variance)
  }
  return out
}

// Retention = surviving ÷ generated per axis. When the generated cohort has zero spread on an axis
// (the makers themselves never varied it) there is no range for selection to eat, so retention is 1
// (perfectly preserved by definition) — never a divide-by-zero NaN.
function retentionRatio(generated: AxisSpread, surviving: AxisSpread): AxisSpread {
  const out = { ...ZERO_SPREAD }
  for (const axis of TRAIT_AXES) {
    out[axis] = generated[axis] === 0 ? 1 : surviving[axis] / generated[axis]
  }
  return out
}

// The selection rule made concrete: rank by score descending, take the upper SURVIVING_FRACTION.
// Ties are resolved by the sort's stability; the cohort is a deterministic function of the rows.
function survivors(rows: readonly ScoredTraits[]): TraitVector[] {
  const ranked = [...rows].sort((a, b) => b.score - a.score)
  const keep = Math.ceil(ranked.length * SURVIVING_FRACTION)
  return ranked.slice(0, keep).map((r) => r.traits)
}

// [LAW:single-enforcer] The ONE place a set of scored generations becomes the breadth picture. The
// generated cohort is every row; the surviving cohort is the top-ranked subset. Both spreads and the
// per-axis retention are derived here so the ceremony, the test, and any future alert read one shape.
export function buildSpreadReport(rows: readonly ScoredTraits[]): SpreadReport {
  const generatedTraits = rows.map((r) => r.traits)
  const survivingTraits = survivors(rows)
  const generated = axisSpread(generatedTraits)
  const surviving = axisSpread(survivingTraits)
  return {
    counts: { generated: generatedTraits.length, surviving: survivingTraits.length },
    spread: { generated, surviving },
    retention: retentionRatio(generated, surviving),
  }
}

// [LAW:no-silent-failure] Names the failure mode this ticket exists to catch: the makers produced the
// void range (generated spread is real) but the surviving cohort retains less than COLLAPSE_RATIO of
// it on a void axis — selection is burying the austere/sparse pole. Requires the generated cohort to
// actually HAVE void-range (spread above a floor) so an empty/uniform DB does not read as "collapse".
export function isCollapsing(report: SpreadReport): boolean {
  return VOID_AXES.some(
    (axis) =>
      report.spread.generated[axis] > 0.05 && report.retention[axis] < COLLAPSE_RATIO,
  )
}
