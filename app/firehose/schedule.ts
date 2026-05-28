// [LAW:types-are-the-program] Schedule is data, not a flag or a cron-string
// parser. The list × the cron tick decides which channels fire; there is no
// branch on environment, feature flag, or cron expression anywhere in the
// orchestrator. Adding a channel is one record in SCHEDULES — no code change.
//
// [LAW:dataflow-not-control-flow] Every wrangler cron tick runs the same code:
// chooseFires(scheduledTimeMs, SCHEDULES) → channel list. An empty list is the
// no-op tick (just returns zero iterations of the per-channel loop in
// scheduled.ts); a non-empty list runs select+execute per channel. The
// schedule never branches on "is this a firing minute" — the data answers.
//
// [LAW:one-source-of-truth] The schedule list lives in this file. wrangler's
// cron expression carries no schedule semantics — it is the tick *granularity*
// only. To support prime periods (47, 53, 73) the cron must be every-minute,
// since 47/53/73 share no divisor with any coarser-grain cron like */5.

// [LAW:types-are-the-program] Channel is a string label (not an enum) so a new
// SCHEDULES entry shows up downstream — metric labels, log fields — without a
// type change. Period and offset are constrained by value, not by type: period
// is documented as prime, offset is documented as 0..period-1. The
// schedule.test.ts asserts both invariants for every entry in SCHEDULES.
export type Schedule = Readonly<{
  channel: string
  periodMinutes: number
  offsetMinutes: number
}>

// Pairwise-coprime primes 47, 53, 73 → joint firing pattern repeats every
// LCM(47, 53, 73) = 181,843 minutes ≈ 126 days. Per-channel cadence:
//   generation-a: 1440/47 ≈ 30.6 fires/day
//   generation-b: 1440/53 ≈ 27.2 fires/day
//   generation-c: 1440/73 ≈ 19.7 fires/day
// Total ≈ 77.5 fires/day. Budget cap in app/firehose/budget.ts is the single
// enforcer for spend — over-budget fires log "skipping" without throwing.
//
// Offsets are pairwise distinct so the three channels do not jointly align at
// t=0 (epoch). The joint-three coincidence is a single CRT residue modulo the
// LCM; for these offsets the first one after epoch lands at minute 75,012
// (~52 days), and the gap between consecutive triple coincidences is the LCM
// itself (~126 days). Pairwise coincidences are more frequent — once every
// LCM(p1, p2) minutes for the two channels involved.
export const SCHEDULES: ReadonlyArray<Schedule> = [
  { channel: 'generation-a', periodMinutes: 47, offsetMinutes: 0 },
  { channel: 'generation-b', periodMinutes: 53, offsetMinutes: 17 },
  { channel: 'generation-c', periodMinutes: 73, offsetMinutes: 41 },
]

// [LAW:types-are-the-program] Pure: same (scheduledTimeMs, schedules) → same
// channels. No clocks, no env, no I/O. Tests pin both directions: at
// t = (offset + k*period) * minutes the channel is in the result; at
// t = (offset + k*period + 1) * minutes it is not.
//
// scheduledTimeMs is the unix-ms timestamp from ScheduledController.scheduledTime;
// we coarsen to integer minutes (the cron granularity) before the modular
// check so sub-minute jitter on the cron firing does not knock alignment off.
export function chooseFires(
  scheduledTimeMs: number,
  schedules: ReadonlyArray<Schedule>,
): ReadonlyArray<string> {
  const tickMinutes = Math.floor(scheduledTimeMs / 60_000)
  return schedules
    .filter((s) => (tickMinutes - s.offsetMinutes) % s.periodMinutes === 0)
    .map((s) => s.channel)
}
