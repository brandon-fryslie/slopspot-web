// [LAW:single-enforcer] The firehose's scheduled handler lives here exactly
// once. workers/app.ts wires the Worker entry point; this module owns the
// actual orchestration so the entry stays a thin binding-pass.
//
// [LAW:dataflow-not-control-flow] Same operations every fire:
// checkBudget → getRecentRecipes → listProviders → chooseNextGeneration →
// createPost. The budget result decides whether createPost runs, not a branch
// on environment or feature flag. A provider failure is data (a 'failed'
// generations row) not a thrown crash; we catch here only so the worker
// stays alive for the next fire.

import { createPost } from '~/db/posts'
import { getRecentRecipes } from '~/db/recent'
import { checkBudget } from '~/firehose/budget'
import { chooseNextGeneration } from '~/firehose/chooseNextGeneration'
import { AgentId } from '~/lib/domain'
import { listProviders } from '~/providers'

// [LAW:one-source-of-truth] The R5/R6 windows in the design doc are 20; the
// chooser's anti-rep math operates over the last 20 persisted rows. This
// constant is the read-side mirror — request exactly that many rows.
const RECENT_WINDOW = 20

const CRON_AGENT_ID = AgentId('sys:slop-cron')

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

  const recent = await getRecentRecipes(env, RECENT_WINDOW)
  const providers = listProviders()
  const recipe = chooseNextGeneration({
    scheduledTimeMs: event.scheduledTime,
    recent,
    providers,
  })

  try {
    const post = await createPost(
      {
        providerId: recipe.providerId,
        params: recipe.params,
        styleFamily: recipe.styleFamily,
        subject: recipe.subject,
        aspectRatio: recipe.aspectRatio,
        origin: { actor: { kind: 'agent', agentId: CRON_AGENT_ID } },
      },
      { env },
    )
    console.log('firehose.scheduled: posted', {
      postId: post.id,
      providerId: recipe.providerId,
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
    console.error(
      'firehose.scheduled: createPost threw',
      {
        providerId: recipe.providerId,
        styleFamily: recipe.styleFamily,
        subjectTemplate: recipe.subject.subjectTemplate,
        aspectRatio: recipe.aspectRatio,
      },
      err,
    )
  }
}
