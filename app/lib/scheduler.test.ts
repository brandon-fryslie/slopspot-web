// [LAW:behavior-not-structure] These tests assert contracts: fire rate converges
// on expectedDailyFires over a full day of ticks, and activeHoursUtc gates
// fires to the specified window. They do not test the hash function's
// implementation — only its behavioral effect on fire probability.

import { describe, expect, it } from 'vitest'
import { NEUTRAL_TRAITS } from '~/lib/traits'
import { parseSchedulerConfig, personasDueNow, shouldFireNow } from './scheduler'
import type { Persona } from '~/agents/persona'
import { AgentId } from '~/lib/domain'

// Build 96 evenly-spaced tick timestamps spanning one UTC day starting at the
// given base date. Mirrors the real cron: every 15 minutes.
function dayTicks(baseDate: Date): Date[] {
  const base = baseDate.getTime()
  return Array.from({ length: 96 }, (_, i) => new Date(base + i * 15 * 60 * 1000))
}

function makePersona(agentId: string, config: Record<string, unknown>): Persona {
  return {
    agentId: AgentId(agentId),
    // Match the production handle format: a slug derived from the agentId
    // (e.g. 'agent:a' -> 'a'), not the raw internal id.
    handle: agentId.replace('agent:', ''),
    displayName: agentId,
    role: 'voter',
    personaPrompt: '',
    modelId: 'glm-4v-flash',
    config,
    traits: NEUTRAL_TRAITS,
  }
}

describe('parseSchedulerConfig', () => {
  it('parses valid config', () => {
    const cfg = parseSchedulerConfig({ expectedDailyFires: 6 })
    expect(cfg.expectedDailyFires).toBe(6)
    expect(cfg.activeHoursUtc).toBeUndefined()
  })

  it('parses config with activeHoursUtc', () => {
    const cfg = parseSchedulerConfig({
      expectedDailyFires: 3,
      activeHoursUtc: { startHour: 0, endHour: 6 },
    })
    expect(cfg.activeHoursUtc).toEqual({ startHour: 0, endHour: 6 })
  })

  it('throws on missing expectedDailyFires', () => {
    expect(() => parseSchedulerConfig({})).toThrow('expectedDailyFires')
  })

  it('throws on zero expectedDailyFires', () => {
    expect(() => parseSchedulerConfig({ expectedDailyFires: 0 })).toThrow('expectedDailyFires')
  })

  it('throws on malformed activeHoursUtc', () => {
    expect(() =>
      parseSchedulerConfig({ expectedDailyFires: 6, activeHoursUtc: 'bad' }),
    ).toThrow('activeHoursUtc')
  })
})

describe('shouldFireNow — fire rate', () => {
  it('5 personas at expectedDailyFires=6 each fire within Poisson bounds over a full day', () => {
    const agentIds = ['agent:a', 'agent:b', 'agent:c', 'agent:d', 'agent:e']
    const config = parseSchedulerConfig({ expectedDailyFires: 6 })
    const ticks = dayTicks(new Date('2026-01-01T00:00:00Z'))

    for (const agentId of agentIds) {
      let count = 0
      for (const tick of ticks) {
        if (shouldFireNow(agentId, config, tick)) count++
      }
      // Binomial(96, 0.0625) 99.5th-percentile bounds: 2 ≤ count ≤ 14.
      // Tighter bounds (e.g. ≤12) would make this test flaky for valid seeds.
      expect(count).toBeGreaterThanOrEqual(2)
      expect(count).toBeLessThanOrEqual(14)
    }
  })

  it('different agents get different fire schedules (not all same ticks)', () => {
    const config = parseSchedulerConfig({ expectedDailyFires: 12 })
    const ticks = dayTicks(new Date('2026-01-01T00:00:00Z'))

    const firesA = ticks.filter((t) => shouldFireNow('agent:a', config, t))
    const firesB = ticks.filter((t) => shouldFireNow('agent:b', config, t))

    // Distinct agents should not fire on identical tick sets
    expect(firesA.map((d) => d.toISOString())).not.toEqual(
      firesB.map((d) => d.toISOString()),
    )
  })
})

describe('shouldFireNow — activeHoursUtc', () => {
  it('no fires outside the 00:00–06:00 UTC window', () => {
    const config = parseSchedulerConfig({
      expectedDailyFires: 96,
      activeHoursUtc: { startHour: 0, endHour: 6 },
    })
    const ticks = dayTicks(new Date('2026-01-01T00:00:00Z'))
    const outsideWindow = ticks.filter((t) => {
      const h = t.getUTCHours()
      return h < 0 || h >= 6
    })

    for (const tick of outsideWindow) {
      expect(shouldFireNow('agent:test', config, tick)).toBe(false)
    }
  })

  it('fires only within the active window', () => {
    // With expectedDailyFires=96 and window of 6h (24 ticks), probability per
    // tick = 96/96 = 1.0 — every tick in window fires.
    const config = parseSchedulerConfig({
      expectedDailyFires: 96,
      activeHoursUtc: { startHour: 0, endHour: 6 },
    })
    const ticks = dayTicks(new Date('2026-01-01T00:00:00Z'))
    const inWindow = ticks.filter((t) => {
      const h = t.getUTCHours()
      return h >= 0 && h < 6
    })

    // All 24 in-window ticks should fire (p=1.0 always hashes below 1.0)
    for (const tick of inWindow) {
      expect(shouldFireNow('agent:test', config, tick)).toBe(true)
    }
  })
})

describe('personasDueNow', () => {
  it('returns exactly the personas shouldFireNow would select individually', () => {
    const personas = Array.from({ length: 5 }, (_, i) =>
      makePersona(`agent:p${i}`, { expectedDailyFires: 48 }),
    )
    const tick = new Date('2026-01-01T12:00:00Z')
    const due = personasDueNow(personas, tick)

    // Ground-truth: independently apply shouldFireNow to each persona
    const expected = personas.filter((p) =>
      shouldFireNow(p.agentId, parseSchedulerConfig(p.config), tick),
    )

    expect(due.map((p) => p.agentId)).toEqual(expected.map((p) => p.agentId))
  })

  it('returns empty list when no personas fire', () => {
    // expectedDailyFires=0 would throw, so we rely on hash variance: very low
    // rate means most single-tick samples return empty. Use a seed known not to fire.
    // Instead, use rate=0 equivalent by having NO personas at all.
    const result = personasDueNow([], new Date('2026-01-01T00:00:00Z'))
    expect(result).toHaveLength(0)
  })
})
