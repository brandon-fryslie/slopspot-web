// [LAW:dataflow-not-control-flow] The schedule decision is a pure function of
// persona config + scheduledTime. Persona rhythm is data on the persona row —
// no per-persona branches here.
//
// The voter service's boundary is the Zod schema in pipeline.ts — that schema
// enforces expectedDailyFires and activeHoursUtc bounds. shouldFireNow here
// receives already-validated config; no second parse needed.

export type SchedulerConfig = {
  expectedDailyFires: number
  activeHoursUtc?: { startHour: number; endHour: number }
}

// 15-minute tick granularity: 96 ticks per 24h.
const TICKS_PER_DAY = 96

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
