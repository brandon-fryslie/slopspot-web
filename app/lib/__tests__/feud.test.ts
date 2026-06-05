// [LAW:behavior-not-structure][enumeration-gap] The stance classifier's CONTRACT: a TOTAL,
// deterministic partition of the (opposing, aligned) count plane — every pair maps to exactly one
// tier, the four boundary predicates are mutually exclusive and exhaustive. The property test sweeps
// the plane and asserts EXACTLY ONE predicate holds per pair AND that stanceOf returns its tier — so a
// future edit that overlaps two tiers or leaves a pair unclassified fails here, not in production.

import { describe, expect, it } from 'vitest'
import { stanceOf, type FeudStance } from '~/lib/feud'

describe('stanceOf — the documented table', () => {
  it('(0,0) → neutral (no shared verdicts)', () => expect(stanceOf(0, 0)).toBe('neutral'))
  it('opposing > aligned → feuding (incl. the lone first clash)', () => {
    expect(stanceOf(1, 0)).toBe('feuding')
    expect(stanceOf(5, 4)).toBe('feuding')
  })
  it('aligned > opposing → allied (incl. a lone agreement)', () => {
    expect(stanceOf(0, 1)).toBe('allied')
    expect(stanceOf(4, 5)).toBe('allied')
  })
  it('opposing == aligned > 0 → wary (clash and agree equally)', () => {
    expect(stanceOf(1, 1)).toBe('wary')
    expect(stanceOf(7, 7)).toBe('wary')
  })
})

describe('stanceOf — TOTAL partition of ℕ² (no gap, no overlap)', () => {
  // The four boundary predicates, stated independently of the implementation — the test cross-checks
  // them against stanceOf so neither can drift without failing.
  const predicates: Record<FeudStance, (o: number, a: number) => boolean> = {
    neutral: (o, a) => o === 0 && a === 0,
    feuding: (o, a) => o > a,
    allied: (o, a) => a > o,
    wary: (o, a) => o === a && o > 0,
  }
  const tiers = Object.keys(predicates) as FeudStance[]

  it('every (opposing, aligned) in [0,40]² matches EXACTLY ONE predicate, and stanceOf returns it', () => {
    for (let o = 0; o <= 40; o++) {
      for (let a = 0; a <= 40; a++) {
        const matching = tiers.filter((t) => predicates[t](o, a))
        // exactly one predicate true for this pair (non-overlap + exhaustive)
        expect(matching, `(${o},${a}) matched ${JSON.stringify(matching)}`).toHaveLength(1)
        // and stanceOf agrees with the predicate that matched
        expect(stanceOf(o, a)).toBe(matching[0])
      }
    }
  })

  it('stanceOf is always one of the four tiers (total — never undefined)', () => {
    for (let o = 0; o <= 20; o++) {
      for (let a = 0; a <= 20; a++) {
        expect(tiers).toContain(stanceOf(o, a))
      }
    }
  })
})
