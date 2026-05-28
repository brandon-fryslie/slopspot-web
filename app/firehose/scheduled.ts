// [LAW:single-enforcer] The firehose's scheduled handler lives here exactly
// once. workers/app.ts wires the Worker entry point; this module owns the
// actual orchestration so the entry stays a thin binding-pass.
//
// [LAW:dataflow-not-control-flow] Same operations every fire:
// checkBudget → (select phase) → (execute phase). The budget result decides
// whether the work phases run, not a branch on environment or feature flag.
// Every failure mode maps to the same outcome — log structurally, never
// crash the worker. Two phase-scoped catches (select vs execute) because
// the available context differs by phase, not because the handling differs.

import { createPost } from '~/db/posts'
import { getRecentRecipes } from '~/db/recent'
import { checkBudget } from '~/firehose/budget'
import {
  chooseNextGeneration,
  type ChooserOutput,
} from '~/firehose/chooseNextGeneration'
import { AgentId } from '~/lib/domain'
import { emit } from '~/observability/metrics'
import { listProviders } from '~/providers'

// [LAW:one-source-of-truth] The R5/R6 windows in the design doc are 20; the
// chooser's anti-rep math operates over the last 20 persisted rows. This
// constant is the read-side mirror — request exactly that many rows.
const RECENT_WINDOW = 20

const CRON_AGENT_ID = AgentId('sys:slop-cron')

// Placeholder channel label. The prime-ratio schedule redesign (slopspot-
// firehose-3cn) will replace this constant with a per-fire channel passed in
// from chooseFires(). Until then, every cron fire emits as 'firehose-default'.
const FIREHOSE_CHANNEL = 'firehose-default'

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
    emit('slopspot.firehose.fire', { channel: FIREHOSE_CHANNEL, outcome: 'skipped-budget' }, 1)
    return
  }

  // [LAW:dataflow-not-control-flow] Both phases of the fire (select + execute)
  // share the same outcome shape: log structurally, never crash the worker.
  // Two distinct catches because the available context differs by phase, not
  // because the error handling is different — the select phase has no recipe
  // to log, the execute phase does. A single catch over both phases would
  // either lose the recipe context on execute failures or require an undefined-
  // tracker on the recipe variable, both worse than the two-phase split.
  let recipe: ChooserOutput
  try {
    const recent = await getRecentRecipes(env, RECENT_WINDOW)
    const providers = listProviders()
    recipe = chooseNextGeneration({
      scheduledTimeMs: event.scheduledTime,
      recent,
      providers,
    })
  } catch (err) {
    // [LAW:single-enforcer] Pre-decision failure: D1 outage, malformed stored
    // row that fails the trust-boundary parse in getRecentRecipes, chooser
    // config bug (e.g., zero-weight pool), or provider params builder throw.
    // There is no row to record state on (createPost hasn't been called); the
    // Workers log is the only record this fire happened. Worker stays alive
    // for the next fire either way.
    console.error(
      'firehose.scheduled: recipe selection failed',
      { scheduledTime: event.scheduledTime },
      err,
    )
    emit('slopspot.firehose.fire', { channel: FIREHOSE_CHANNEL, outcome: 'skipped-error' }, 1)
    return
  }

  try {
    const post = await createPost(
      {
        kind: 'generation',
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
    emit('slopspot.firehose.fire', { channel: FIREHOSE_CHANNEL, outcome: 'fired' }, 1)
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
    emit('slopspot.firehose.fire', { channel: FIREHOSE_CHANNEL, outcome: 'skipped-error' }, 1)
  }
}
