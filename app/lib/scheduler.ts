// [LAW:dataflow-not-control-flow] The schedule decision is a pure function of
// persona config + scheduledTime. Persona rhythm is data on the persona row —
// no per-persona branches here.
//
// [LAW:types-are-the-program] parseSchedulerConfig throws loud on invalid
// config so the scheduler never silently defaults. A missing expectedDailyFires
// is a misconfigured row, surfaced immediately.

import type { Persona } from '~/agents/persona'
import { unitFloat } from '~/lib/hash'

export type SchedulerConfig = {
  expectedDailyFires: number
  activeHoursUtc?: { startHour: number; endHour: number }
}

// 15-minute tick granularity: 96 ticks per 24h.
const TICKS_PER_DAY = 96

// [LAW:types-are-the-program] Parse at the boundary; no `?? 6` fallback that
// would hide a misconfigured row. Missing expectedDailyFires fails loud.
export function parseSchedulerConfig(config: Record<string, unknown>): SchedulerConfig {
  const expectedDailyFires = config['expectedDailyFires']
  if (typeof expectedDailyFires !== 'number' || expectedDailyFires <= 0) {
    throw new Error(
      `scheduler: invalid expectedDailyFires: ${JSON.stringify(expectedDailyFires)}`,
    )
  }

  const raw = config['activeHoursUtc']
  if (raw === undefined || raw === null) {
    return { expectedDailyFires }
  }

  const r = raw as Record<string, unknown>
  const startHour = r['startHour']
  const endHour = r['endHour']

  if (
    typeof raw !== 'object' ||
    !Number.isInteger(startHour) ||
    !Number.isInteger(endHour) ||
    typeof startHour !== 'number' ||
    typeof endHour !== 'number' ||
    startHour < 0 ||
    startHour >= 24 ||
    endHour <= 0 ||
    endHour > 24 ||
    startHour >= endHour
  ) {
    throw new Error(
      `scheduler: invalid activeHoursUtc (require 0 <= startHour < endHour <= 24): ${JSON.stringify(raw)}`,
    )
  }

  return {
    expectedDailyFires,
    activeHoursUtc: { startHour, endHour },
  }
}

// [LAW:dataflow-not-control-flow] The hash bucket and the hour-window check
// are data tests on fixed inputs — no conditional branches that skip work.
// activeHoursUtc is a filter value, not a mode switch.
export function shouldFireNow(
  agentId: string,
  config: SchedulerConfig,
  scheduledTime: Date,
): boolean {
  const { expectedDailyFires, activeHoursUtc } = config

  if (activeHoursUtc !== undefined) {
    const hour = scheduledTime.getUTCHours()
    if (hour < activeHoursUtc.startHour || hour >= activeHoursUtc.endHour) {
      return false
    }
  }

  // Fire probability per tick = expectedDailyFires / TICKS_PER_DAY.
  // [LAW:one-source-of-truth] Key is `${timeISO}:${agentId}` — seed (the tick) FIRST, the per-agent
  // discriminator LAST. The prior `${agentId}:${timeISO}` form put agentId before a shared
  // `:${timeISO}` suffix, so two agents at the same tick re-correlate their fire decisions via
  // FNV-1a (the defect proven in breed.ts) — agents must decide independently. unitFloat maps the
  // hash onto [0,1) (no bare /0x100000000 magic).
  const probability = expectedDailyFires / TICKS_PER_DAY
  const bucket = unitFloat(`${scheduledTime.toISOString()}:${agentId}`)
  return bucket < probability
}

// Filters to personas whose config says they should fire on this tick.
export function personasDueNow(personas: Persona[], scheduledTime: Date): Persona[] {
  return personas.filter((p) => {
    const config = parseSchedulerConfig(p.config)
    return shouldFireNow(p.agentId, config, scheduledTime)
  })
}
