// [LAW:behavior-not-structure] The pure breadth math's contract a blind reader could check: dispersion
// is measured, the surviving cohort is the top-ranked-by-score slice, and "selection is eating the range"
// (generated wide, surviving narrow on a void axis) is named loud by isCollapsing. No assertion on the
// stddev formula's internals — the WIN (a collapse is detectable) itself.

import { describe, expect, it } from 'vitest'
import type { TraitVector } from '~/lib/domain'
import {
  axisSpread,
  buildSpreadReport,
  isCollapsing,
  SURVIVING_FRACTION,
  type ScoredTraits,
} from '~/lib/trait-spread'

const v = (austerity: number, density: number): TraitVector => ({
  austerity,
  curse: 0.5,
  density,
  earnestness: 0.5,
})

describe('axisSpread', () => {
  it('an identical set has zero dispersion on every axis', () => {
    const s = axisSpread([v(0.2, 0.2), v(0.2, 0.2), v(0.2, 0.2)])
    expect(s.austerity).toBeCloseTo(0, 10)
    expect(s.density).toBeCloseTo(0, 10)
  })

  it('an empty cohort reduces to zero spread (no deviation to measure), not a throw', () => {
    expect(axisSpread([])).toEqual({ austerity: 0, curse: 0, density: 0, earnestness: 0 })
  })

  it('a wide set has real dispersion', () => {
    const s = axisSpread([v(0.1, 0.1), v(0.5, 0.5), v(0.9, 0.9)])
    expect(s.austerity).toBeGreaterThan(0.3)
    expect(s.density).toBeGreaterThan(0.3)
  })
})

describe('buildSpreadReport — surviving = top-ranked by score', () => {
  it('keeps the top SURVIVING_FRACTION by score as the surviving cohort', () => {
    const rows: ScoredTraits[] = [
      { traits: v(0.1, 0.1), score: 1 },
      { traits: v(0.5, 0.5), score: 2 },
      { traits: v(0.9, 0.9), score: 9 },
    ]
    const report = buildSpreadReport(rows)
    expect(report.counts.generated).toBe(3)
    // ceil(3 * 1/3) = 1 survivor — the single highest-scored (the baroque-dense one).
    expect(report.counts.surviving).toBe(Math.ceil(3 * SURVIVING_FRACTION))
    expect(report.counts.surviving).toBe(1)
    // A one-element surviving cohort has zero spread by definition.
    expect(report.spread.surviving.austerity).toBe(0)
  })
})

describe('isCollapsing — selection eating the range', () => {
  // Generated spans the void axes wide; survivors (top third by score) keep that range → healthy.
  const healthy: ScoredTraits[] = [
    { traits: v(0.1, 0.1), score: 9 }, // a void piece that SURVIVES
    { traits: v(0.9, 0.9), score: 8 }, // a baroque piece that survives
    { traits: v(0.5, 0.5), score: 7 },
    { traits: v(0.2, 0.3), score: 1 },
    { traits: v(0.8, 0.7), score: 0 },
    { traits: v(0.4, 0.6), score: -1 },
  ]

  // Same generated range, but score tracks baroque-ness: the void pieces sink, survivors cluster baroque.
  const collapsing: ScoredTraits[] = [
    { traits: v(0.9, 0.9), score: 9 }, // baroque survives
    { traits: v(0.85, 0.8), score: 8 }, // baroque survives
    { traits: v(0.8, 0.9), score: 7 }, // baroque survives
    { traits: v(0.5, 0.5), score: 1 },
    { traits: v(0.15, 0.2), score: 0 }, // void SINKS
    { traits: v(0.1, 0.1), score: -2 }, // void SINKS
  ]

  it('does NOT flag a healthy feed — survivors retain the void range', () => {
    const report = buildSpreadReport(healthy)
    expect(isCollapsing(report)).toBe(false)
  })

  it('FLAGS a collapsing feed — survivors have lost the void range, with numbers', () => {
    const report = buildSpreadReport(collapsing)
    expect(isCollapsing(report)).toBe(true)
    // The generated cohort genuinely HAD void range...
    expect(report.spread.generated.austerity).toBeGreaterThan(0.05)
    // ...that the surviving cohort has eaten — retention on a void axis below half.
    expect(report.retention.austerity).toBeLessThan(0.5)
  })

  it('does NOT false-flag an empty/uniform feed as collapse (no range to eat)', () => {
    expect(isCollapsing(buildSpreadReport([]))).toBe(false)
    const uniform: ScoredTraits[] = [
      { traits: v(0.5, 0.5), score: 3 },
      { traits: v(0.5, 0.5), score: 2 },
      { traits: v(0.5, 0.5), score: 1 },
    ]
    expect(isCollapsing(buildSpreadReport(uniform))).toBe(false)
  })
})
