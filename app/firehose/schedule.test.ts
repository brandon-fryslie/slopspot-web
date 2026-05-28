import { describe, expect, it } from 'vitest'
import { SCHEDULES, chooseFires, type Schedule } from './schedule'

// [LAW:behavior-not-structure] These tests assert the chooseFires contract
// (firing alignment is a pure modular check on integer minutes) and the
// SCHEDULES invariants the design requires (prime periods, distinct channels,
// reasonable daily fire count). They do not assert *how* chooseFires composes
// the modular math — only the observable outcomes.

const MIN = 60_000

describe('chooseFires', () => {
  it('returns no channels when the schedule list is empty', () => {
    expect(chooseFires(0, [])).toEqual([])
    expect(chooseFires(1_700_000_000_000, [])).toEqual([])
  })

  it('fires a channel at t = (offset + k*period) minutes', () => {
    const s: Schedule = { channel: 'x', periodMinutes: 47, offsetMinutes: 11 }
    for (const k of [0, 1, 2, 7, 30, 100]) {
      const t = (s.offsetMinutes + k * s.periodMinutes) * MIN
      expect(chooseFires(t, [s])).toEqual(['x'])
    }
  })

  it('does not fire at t = (offset + k*period + 1) minutes', () => {
    const s: Schedule = { channel: 'x', periodMinutes: 47, offsetMinutes: 11 }
    for (const k of [0, 1, 2, 7, 30, 100]) {
      const t = (s.offsetMinutes + k * s.periodMinutes + 1) * MIN
      expect(chooseFires(t, [s])).toEqual([])
    }
  })

  it('coarsens sub-minute jitter: alignment is by integer minute', () => {
    const s: Schedule = { channel: 'x', periodMinutes: 47, offsetMinutes: 0 }
    // Same minute (0 through 59,999 ms), still aligned.
    expect(chooseFires(0, [s])).toEqual(['x'])
    expect(chooseFires(59_999, [s])).toEqual(['x'])
    // One minute later, no longer aligned.
    expect(chooseFires(60_000, [s])).toEqual([])
  })

  it('returns multiple channels when several align on the same tick', () => {
    const a: Schedule = { channel: 'a', periodMinutes: 47, offsetMinutes: 0 }
    const b: Schedule = { channel: 'b', periodMinutes: 53, offsetMinutes: 0 }
    // LCM(47, 53) = 2491 minutes is the first joint alignment after t=0.
    expect(chooseFires(47 * 53 * MIN, [a, b])).toEqual(['a', 'b'])
  })

  it('preserves the schedules-array order in the returned channel list', () => {
    const a: Schedule = { channel: 'a', periodMinutes: 47, offsetMinutes: 0 }
    const b: Schedule = { channel: 'b', periodMinutes: 53, offsetMinutes: 0 }
    // chooseFires is a filter — order follows the input. Swapping the input
    // order must swap the output order; downstream consumers (per-channel emit)
    // can depend on this.
    expect(chooseFires(47 * 53 * MIN, [b, a])).toEqual(['b', 'a'])
  })
})

describe('SCHEDULES (invariants)', () => {
  it('each entry fires at its first post-epoch alignment and not one minute off', () => {
    for (const s of SCHEDULES) {
      const aligned = (s.offsetMinutes + s.periodMinutes) * MIN
      expect(chooseFires(aligned, [s])).toEqual([s.channel])
      expect(chooseFires(aligned + MIN, [s])).toEqual([])
    }
  })

  it('all periods are prime (preserves pairwise-coprime joint LCM)', () => {
    const isPrime = (n: number): boolean => {
      if (n < 2) return false
      for (let i = 2; i * i <= n; i++) {
        if (n % i === 0) return false
      }
      return true
    }
    for (const s of SCHEDULES) {
      expect(isPrime(s.periodMinutes)).toBe(true)
    }
  })

  it('all channels are unique', () => {
    const names = SCHEDULES.map((s) => s.channel)
    expect(new Set(names).size).toBe(names.length)
  })

  it('all periods are pairwise distinct (with primality, this is pairwise coprime)', () => {
    const periods = SCHEDULES.map((s) => s.periodMinutes)
    expect(new Set(periods).size).toBe(periods.length)
  })

  it('each offset is in [0, period)', () => {
    for (const s of SCHEDULES) {
      expect(s.offsetMinutes).toBeGreaterThanOrEqual(0)
      expect(s.offsetMinutes).toBeLessThan(s.periodMinutes)
    }
  })

  it('over a 24h window, fires-per-channel match 1440 / period within ±1', () => {
    const counts = new Map<string, number>()
    for (const s of SCHEDULES) counts.set(s.channel, 0)
    for (let m = 0; m < 1440; m++) {
      for (const channel of chooseFires(m * MIN, SCHEDULES)) {
        counts.set(channel, (counts.get(channel) ?? 0) + 1)
      }
    }
    for (const s of SCHEDULES) {
      const expected = 1440 / s.periodMinutes
      const actual = counts.get(s.channel)!
      // A periodic schedule fires exactly floor(1440/period) or ceil(1440/period)
      // times in a 1440-minute window depending on offset alignment; anything
      // outside that range is an off-by-one in the modular check.
      expect(actual).toBeGreaterThanOrEqual(Math.floor(expected))
      expect(actual).toBeLessThanOrEqual(Math.ceil(expected))
    }
  })
})
