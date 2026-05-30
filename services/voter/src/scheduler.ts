// [LAW:dataflow-not-control-flow] The schedule decision is a pure function of
// persona config + scheduledTime. Persona rhythm is data on the persona row —
// no per-persona branches here.
//
// [LAW:types-are-the-program] parseSchedulerConfig throws loud on invalid
// config so the scheduler never silently defaults. A missing expectedDailyFires
// is a misconfigured row, surfaced immediately.
//
// NOTE: This mirrors app/lib/scheduler.ts exactly. Both are independently
// pure modules — shared extraction would couple the Worker app to a homelab
// Node.js service over a ~60-line file.

export type SchedulerConfig = {
  expectedDailyFires: number
  activeHoursUtc?: { startHour: number; endHour: number }
}

// 15-minute tick granularity: 96 ticks per 24h.
const TICKS_PER_DAY = 96

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

  if (
    typeof raw !== 'object' ||
    typeof (raw as Record<string, unknown>)['startHour'] !== 'number' ||
    typeof (raw as Record<string, unknown>)['endHour'] !== 'number'
  ) {
    throw new Error(
      `scheduler: invalid activeHoursUtc: ${JSON.stringify(raw)}`,
    )
  }

  return {
    expectedDailyFires,
    activeHoursUtc: raw as { startHour: number; endHour: number },
  }
}

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

  const probability = expectedDailyFires / TICKS_PER_DAY
  const hash = fnv1a32(`${agentId}:${scheduledTime.toISOString()}`)
  const bucket = hash / 0x100000000
  return bucket < probability
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}
