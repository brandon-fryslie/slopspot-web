import { describe, expect, it } from 'vitest'
import { PROMPT_COUNT, pickPrompt } from './pickPrompt'

const MINUTE = 60 * 1000
const SIX_HOURS = 6 * 60 * MINUTE

describe('pickPrompt', () => {
  it('is deterministic: same scheduledTime → same prompt', () => {
    const t = Date.UTC(2026, 5, 17, 12, 0, 0)
    expect(pickPrompt(t)).toBe(pickPrompt(t))
  })

  it('covers every prompt over a long enough window', () => {
    // Drive a year of cron fires (4/day × 365) through it; every prompt should
    // appear at least once if the distribution is sane.
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    const seen = new Set<string>()
    for (let i = 0; i < 365 * 4; i++) {
      seen.add(pickPrompt(t0 + i * SIX_HOURS))
    }
    expect(seen.size).toBe(PROMPT_COUNT)
  })

  it('does not collapse onto a single prompt at the production cron cadence', () => {
    // The original `(tick % len)` formulation collided every 6h because
    // 360 minutes mod 10 == 0. A real hash must spread across the cadence.
    const t0 = Date.UTC(2026, 5, 17, 0, 0, 0)
    const seen = new Set<string>()
    for (let i = 0; i < PROMPT_COUNT; i++) {
      seen.add(pickPrompt(t0 + i * SIX_HOURS))
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('distributes near-uniformly over many fires (no bucket gets more than 3x the average)', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    const N = 10_000
    const counts = new Map<string, number>()
    for (let i = 0; i < N; i++) {
      const p = pickPrompt(t0 + i * SIX_HOURS)
      counts.set(p, (counts.get(p) ?? 0) + 1)
    }
    const avg = N / PROMPT_COUNT
    for (const c of counts.values()) {
      expect(c).toBeLessThan(avg * 3)
      expect(c).toBeGreaterThan(avg / 3)
    }
  })

  it('handles t=0 without throwing or returning undefined', () => {
    expect(typeof pickPrompt(0)).toBe('string')
    expect(pickPrompt(0).length).toBeGreaterThan(0)
  })

  it('handles negative times (defensive against bad scheduledTime) without index underflow', () => {
    expect(typeof pickPrompt(-MINUTE)).toBe('string')
  })
})
