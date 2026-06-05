import { describe, expect, it } from 'vitest'
import { recencyWeight } from '~/lib/recency'

// [LAW:behavior-not-structure] The decay's contract: full weight at age 0, halving every half-life,
// monotonically decreasing, never negative, never amplifying (a future-dated act clamps to full).
// The rate is the caller's; the SHAPE is what this pins.

const HL = 30 * 24 * 60 * 60 * 1000 // 30 days, the genepool's rate — but any positive rate works

describe('recencyWeight', () => {
  it('is 1 at age 0 (a just-cast act counts in full)', () => {
    expect(recencyWeight(0, HL)).toBe(1)
  })

  it('halves every half-life', () => {
    expect(recencyWeight(HL, HL)).toBeCloseTo(0.5, 12)
    expect(recencyWeight(2 * HL, HL)).toBeCloseTo(0.25, 12)
    expect(recencyWeight(3 * HL, HL)).toBeCloseTo(0.125, 12)
  })

  it('decreases monotonically with age and stays in (0, 1]', () => {
    let prev = recencyWeight(0, HL)
    for (let k = 1; k <= 20; k++) {
      const w = recencyWeight(k * HL * 0.3, HL)
      expect(w).toBeLessThan(prev)
      expect(w).toBeGreaterThan(0)
      expect(w).toBeLessThanOrEqual(1)
      prev = w
    }
  })

  it('clamps a future-dated act (negative age) to full weight, never above 1', () => {
    expect(recencyWeight(-HL, HL)).toBe(1)
    expect(recencyWeight(-1, HL)).toBe(1)
  })

  it('is rate-relative: the same age weighs more under a longer half-life', () => {
    const age = 10 * 24 * 60 * 60 * 1000 // 10 days
    expect(recencyWeight(age, HL)).toBeGreaterThan(recencyWeight(age, HL / 3)) // slower decay = more weight retained
  })
})
