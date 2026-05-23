// [LAW:single-enforcer] The firehose's scheduled handler lives here exactly
// once. workers/app.ts wires the Worker entry point; this module owns the
// actual orchestration so the entry stays a thin binding-pass.
//
// [LAW:dataflow-not-control-flow] Same three operations every fire:
// checkBudget → pickPrompt → createPost. The budget result decides whether
// createPost runs, not a branch on environment or feature flag. A provider
// failure is data (a 'failed' generations row) not a thrown crash; we catch
// here only so the worker stays alive for the next fire.

import { createPost } from '~/db/posts'
import { checkBudget } from '~/firehose/budget'
import { pickPrompt } from '~/firehose/pickPrompt'
import { AgentId, ProviderId } from '~/lib/domain'

// [LAW:one-source-of-truth] Provider id and cron agent id are constants of the
// firehose, not configuration. Variety.5 replaces this with a chooser; until
// then, the cron is fal-flux, period.
const FIREHOSE_PROVIDER = ProviderId('fal-flux')
const CRON_AGENT_ID = AgentId('sys:slop-cron')

// fal-flux schnell tops out at 4 inference steps and we want the cheapest
// non-degenerate output, so 4 steps + square is the production setting.
const FIREHOSE_PARAMS = {
  aspectRatio: '1:1' as const,
  steps: 4,
}

export async function runScheduled(
  event: ScheduledController,
  env: Env,
): Promise<void> {
  const budget = await checkBudget(env)
  if (!budget.withinBudget) {
    // [LAW:no-silent-fallbacks] Over-budget is a deliberate outcome, not an
    // error. Log it loudly enough to be observable in Workers logs without
    // throwing — the worker's other invocations should keep running.
    console.log('firehose.scheduled: over budget; skipping', {
      spentUsd: budget.spentUsd,
      ceilingUsd: budget.ceilingUsd,
      scheduledTime: event.scheduledTime,
    })
    return
  }

  const prompt = pickPrompt(event.scheduledTime)

  try {
    const post = await createPost(
      {
        providerId: FIREHOSE_PROVIDER,
        params: { ...FIREHOSE_PARAMS, prompt },
        origin: { actor: { kind: 'agent', agentId: CRON_AGENT_ID } },
      },
      { env },
    )
    console.log('firehose.scheduled: posted', { postId: post.id, prompt })
  } catch (err) {
    // [LAW:no-defensive-null-guards] This catch is at a trust boundary — the
    // Workers scheduled handler. createPost has already persisted the failure
    // as a 'failed' generations row (its own try/catch owns that), so the row
    // is the source of truth for "what happened." We catch here only to keep
    // the worker alive; re-throwing would abort the scheduled invocation and
    // lose the log line.
    // [LAW:no-silent-fallbacks] Log the raw error as a separate argument so
    // Workers' log renderer preserves the stack trace; collapsing to
    // `err.message` here would drop the most useful diagnostic. The
    // generations row still carries `describeError`'s structured detail for
    // long-term observability — this log is the operator-side breadcrumb.
    console.error('firehose.scheduled: createPost threw', { prompt }, err)
  }
}
