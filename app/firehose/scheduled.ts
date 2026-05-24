// [LAW:single-enforcer] The firehose's scheduled handler lives here exactly
// once. workers/app.ts wires the Worker entry point; this module owns the
// actual orchestration so the entry stays a thin binding-pass.
//
// [LAW:dataflow-not-control-flow] Same three operations every fire:
// checkBudget → chooseNextGeneration → createPost. The budget result decides
// whether createPost runs, not a branch on environment or feature flag. A
// provider failure is data (a 'failed' generations row) not a thrown crash;
// we catch here only so the worker stays alive for the next fire.

import { createPost } from '~/db/posts'
import { checkBudget } from '~/firehose/budget'
import { chooseNextGeneration } from '~/firehose/chooseNextGeneration'
import { AgentId, ProviderId } from '~/lib/domain'

// [LAW:one-source-of-truth] Provider id and cron agent id are constants of the
// firehose, not configuration. pl6.5 will replace the hardcoded provider
// with a chooser that reads the model-assignment table; until then, the cron
// is fal-flux for every style family (transitional, not permanent — see
// design-docs/variety.md §Model assignment).
const FIREHOSE_PROVIDER = ProviderId('fal-flux')
const CRON_AGENT_ID = AgentId('sys:slop-cron')

// fal-flux schnell tops out at 4 inference steps; 4 is the production setting
// (cheapest non-degenerate output). Aspect ratio is no longer a provider
// param — it lives on the recipe and is set by the chooser.
const FIREHOSE_STEPS = 4

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

  const recipe = chooseNextGeneration(event.scheduledTime)

  try {
    const post = await createPost(
      {
        providerId: FIREHOSE_PROVIDER,
        params: { prompt: recipe.prompt, steps: FIREHOSE_STEPS },
        styleFamily: recipe.styleFamily,
        subject: recipe.subject,
        aspectRatio: recipe.aspectRatio,
        origin: { actor: { kind: 'agent', agentId: CRON_AGENT_ID } },
      },
      { env },
    )
    console.log('firehose.scheduled: posted', {
      postId: post.id,
      styleFamily: recipe.styleFamily,
      subjectTemplate: recipe.subject.subjectTemplate,
      aspectRatio: recipe.aspectRatio,
    })
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
    console.error('firehose.scheduled: createPost threw', { recipe }, err)
  }
}
