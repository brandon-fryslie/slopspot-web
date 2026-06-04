// [LAW:single-enforcer] The firehose's scheduled handler lives here exactly
// once. workers/app.ts wires the Worker entry point; this module owns the
// producer orchestration so the entry stays a thin binding-pass.
//
// [LAW:locality-or-seam] This is the PRODUCER half of the cron seam. It does
// no generation work: chooseFires (pure) → enqueue a GenJob per fired channel
// onto GEN_QUEUE. The heavy work (budget query, Haiku, provider polling, R2
// ingest) lives in the queue consumer (gen-queue.ts), billed on a separate
// invocation class. The scheduled (serving-class) invocation collapses to
// chooseFires + N sends — structurally incapable of running generation CPU.
//
// [LAW:dataflow-not-control-flow] Every cron tick runs the same code:
// chooseFires(scheduledTime, SCHEDULES) returns a channel list (possibly
// empty); the loop enqueues one job per channel. An empty list enqueues nothing
// — zero iterations, not an `if` that skips work. The schedule data decides
// which channels fire, not a branch on cron expression.

import type { GenJob } from '~/firehose/gen-queue'
import { SCHEDULES, chooseFires } from '~/firehose/schedule'

export async function runScheduled(
  event: ScheduledController,
  env: Env,
): Promise<void> {
  const channels = chooseFires(event.scheduledTime, SCHEDULES)
  // [LAW:dataflow-not-control-flow] Empty list → zero sends. Most ticks (~95%
  // with every-minute cron and 3 prime channels) yield an empty list and this
  // loop is a no-op without an `if` guard. A fired channel becomes one GenJob;
  // the channel label and the tick's scheduledTime ride the message so the
  // consumer can attribute the fire metric and reproduce the recipe seed.
  for (const channel of channels) {
    const job: GenJob = { channel, scheduledTimeMs: event.scheduledTime }
    await env.GEN_QUEUE.send(job)
    console.log('firehose.scheduled: enqueued', {
      channel,
      scheduledTime: event.scheduledTime,
    })
  }
}
