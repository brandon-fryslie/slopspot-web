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
//
// [LAW:no-silent-fallbacks] runOneJob is TOTAL: it never throws. Every I/O that
// can fail — the budget query (checkBudget hits live D1; a transient 503 throws)
// AND the authoring pass (runGeneratorPass throws on any provider/creation error)
// — is INSIDE the single try, so every failure maps to a skipped-error metric +
// a loud log and the function returns normally. This totality is load-bearing:
// runGenJobs acks every message only because runOneJob cannot throw out of the
// batch loop. A budget-query throw left OUTSIDE this try would abort the loop
// mid-batch and, under max_retries:0, drop the remaining messages SILENTLY with
// no metric — the exact regression this shape forbids. A dropped fire self-heals
// on the next tick (generation is non-idempotent; it must never be replayed),
// but it is always SIGNALLED, never silent.
async function runOneJob(job: GenJob, env: Env): Promise<void> {
  try {
    const budget = await checkBudget(env)
    if (!budget.withinBudget) {
      // [LAW:no-silent-fallbacks] Over-budget is a DELIBERATE, distinct outcome
      // (the budget enforcer working as designed), not an error — its own metric
      // label so the dashboard separates "suppressed by cap" from "failed". The
      // message is still acked by the caller; a retry would never become
      // in-budget on its own and generation is non-idempotent.
      console.log('firehose.gen-queue: over budget; skipping', {
        spentUsd: budget.spentUsd,
        ceilingUsd: budget.ceilingUsd,
        channel: job.channel,
        scheduledTime: job.scheduledTimeMs,
      })
      emit('slopspot.firehose.fire', { channel: job.channel, outcome: 'skipped-budget' }, 1)
      return
    }
    await runGeneratorPass(env, job.scheduledTimeMs)
    emit('slopspot.firehose.fire', { channel: job.channel, outcome: 'fired' }, 1)
  } catch (err) {
    // Any failure (budget query OR authoring) → one loud log + skipped-error,
    // root cause preserved (err as a separate console arg so Workers logs keep
    // the stack), no rethrow. One job's failure cannot abort its batch-mates.
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
// Every message is acked regardless of outcome (fired | skipped-budget |
// skipped-error). This is correct ONLY because runOneJob is total — it cannot
// throw, so the loop always reaches ack() for every message and never drops a
// batch-mate. A generation must never be replayed (non-idempotent,
// max_retries:0), so ack-always is the right contract: a failed fire is signalled
// by skipped-error and left to self-heal on the next tick, not retried.
export async function runGenJobs(batch: MessageBatch<GenJob>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    await runOneJob(message.body, env)
    message.ack()
  }
}
