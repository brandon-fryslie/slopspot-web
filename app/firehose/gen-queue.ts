// [LAW:locality-or-seam] The generation consumer half of the cron seam. The
// scheduled producer (scheduled.ts) emits a GenJob per fired channel; this
// module drains them on the QUEUE invocation class — a billing/CPU boundary
// distinct from the serving (fetch/scheduled) path. All the heavy work (Haiku
// compose + provider polling + R2 ingest, inside runGeneratorPass) happens
// here, so generation CPU is never charged to a serving-class invocation.
//
// [LAW:types-are-the-program] GenJob is the seam value. `channel` is the metric
// label (carried from the producer so the fire metric still attributes per
// channel); `scheduledTimeMs` is the chooser's RNG seed AND the persona-pick
// seed (runGeneratorPass hashes it) — passing it through the message keeps a
// fire reproducible from its originating tick across the queue round-trip.

import { runGeneratorPass } from '~/agents/generator'
import { checkBudget } from '~/firehose/budget'
import { emit } from '~/observability/metrics'

export type GenJob = {
  readonly channel: string
  readonly scheduledTimeMs: number
}

// [LAW:single-enforcer] checkBudget stays the one spend authority and
// runGeneratorPass the one authoring enforcer; this consumer only *invokes*
// them on a different invocation class. The budget is checked per job (not once
// per producing tick): with max_concurrency:1 + the sequential ack loop, each
// fire's check reads every prior committed fire's spend, so the cap reflects
// actual fire time — strictly more honest than the old once-per-tick snapshot.
async function runOneJob(job: GenJob, env: Env): Promise<void> {
  const budget = await checkBudget(env)
  if (!budget.withinBudget) {
    // [LAW:no-silent-fallbacks] Over-budget is a deliberate outcome, not an
    // error: log the suppressed fire and emit skipped-budget so the per-channel
    // dashboard reflects it. The message is still acked by the caller (a retry
    // would never become in-budget on its own and generation is non-idempotent).
    console.log('firehose.gen-queue: over budget; skipping', {
      spentUsd: budget.spentUsd,
      ceilingUsd: budget.ceilingUsd,
      channel: job.channel,
      scheduledTime: job.scheduledTimeMs,
    })
    emit('slopspot.firehose.fire', { channel: job.channel, outcome: 'skipped-budget' }, 1)
    return
  }

  // [LAW:no-silent-fallbacks] runGeneratorPass throws on any I/O or creation
  // error; the catch logs + emits skipped-error without swallowing the root
  // cause and without rethrowing — one job's failure must not abort its
  // batch-mates (mirrors the old runOneFire's keep-the-worker-alive contract).
  try {
    await runGeneratorPass(env, job.scheduledTimeMs)
    emit('slopspot.firehose.fire', { channel: job.channel, outcome: 'fired' }, 1)
  } catch (err) {
    console.error(
      'firehose.gen-queue: fire failed',
      { channel: job.channel, scheduledTime: job.scheduledTimeMs },
      err,
    )
    emit('slopspot.firehose.fire', { channel: job.channel, outcome: 'skipped-error' }, 1)
  }
}

// [LAW:dataflow-not-control-flow] Same code every batch: iterate the messages,
// run each job, ack each. The sequential await is LOAD-BEARING for anti-rep —
// job B's getRecentRecipes (inside runGeneratorPass) runs only after job A's
// createPost commits, so A sits at recent[0] and the R1/R3/R4 push-away rules
// see it. max_concurrency:1 (wrangler.jsonc) extends that guarantee across
// batches: no two consumer invocations overlap, so generation is globally
// serialized. Parallelizing here OR raising max_concurrency would break
// anti-rep silently — both are invariants, not perf choices.
//
// Every message is acked regardless of fire/skip/error outcome: runOneJob never
// throws, and a generation must never be replayed (non-idempotent, max_retries:0).
export async function runGenJobs(batch: MessageBatch<GenJob>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    await runOneJob(message.body, env)
    message.ack()
  }
}
