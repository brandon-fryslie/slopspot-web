// [LAW:single-enforcer] The firehose's scheduled handler lives here exactly
// once. workers/app.ts wires the Worker entry point; this module owns the
// actual orchestration so the entry stays a thin binding-pass.
//
// [LAW:dataflow-not-control-flow] Every cron tick runs the same code:
// chooseFires(scheduledTime, SCHEDULES) returns a list of channels (possibly
// empty); the loop body runs select+execute per channel. An empty list is the
// no-op tick — zero iterations, not an `if` that skips work. The schedule data
// decides which channels fire, not a branch on cron expression.
//
// [LAW:single-enforcer] The budget check runs once per tick (not once per
// channel) — checkBudget is the single source of truth for the 24h spend cap,
// and per-channel re-evaluation would either double-count or drift.

import { createPost } from '~/db/posts'
import { getRecentRecipes } from '~/db/recent'
import { checkBudget } from '~/firehose/budget'
import {
  chooseNextGeneration,
  type ChooserOutput,
} from '~/firehose/chooseNextGeneration'
import { SCHEDULES, chooseFires } from '~/firehose/schedule'
import { AgentId } from '~/lib/domain'
import { emit } from '~/observability/metrics'
import { realProviders } from '~/providers'

// [LAW:one-source-of-truth] The R5/R6 windows in the design doc are 20; the
// chooser's anti-rep math operates over the last 20 persisted rows. This
// constant is the read-side mirror — request exactly that many rows.
const RECENT_WINDOW = 20

const CRON_AGENT_ID = AgentId('sys:slop-cron')

export async function runScheduled(
  event: ScheduledController,
  env: Env,
): Promise<void> {
  const channels = chooseFires(event.scheduledTime, SCHEDULES)
  // [LAW:dataflow-not-control-flow] Empty list → zero iterations downstream.
  // Most ticks (~95% with every-minute cron and 3 prime channels) yield an
  // empty list; we return without touching D1 or the chooser so a no-op tick
  // costs nothing.
  if (channels.length === 0) return

  const budget = await checkBudget(env)
  if (!budget.withinBudget) {
    // [LAW:no-silent-fallbacks] Over-budget is a deliberate outcome, not an
    // error. Emit one skipped-budget per channel so per-channel dashboards
    // reflect the suppressed fires; one structured log carries the whole tick.
    console.log('firehose.scheduled: over budget; skipping', {
      spentUsd: budget.spentUsd,
      ceilingUsd: budget.ceilingUsd,
      scheduledTime: event.scheduledTime,
      channels,
    })
    for (const channel of channels) {
      emit('slopspot.firehose.fire', { channel, outcome: 'skipped-budget' }, 1)
    }
    return
  }

  // [LAW:dataflow-not-control-flow] Same select+execute pipeline per channel.
  // Channel is metadata on the metric and log line; the chooser has no per-
  // channel weight tables (that's variety-chooser territory, deferred). But
  // because each channel's getRecentRecipes runs AFTER the prior channel's
  // createPost in the same tick, the just-written row sits at recent[0] for
  // the second channel — so R1/R3 (hard-reject most-recent style/provider)
  // and R2/R4 (subject/aspect rules) actively push the second channel's
  // recipe away from the first. Sequential await is what wires the anti-rep
  // machinery across channels; parallelizing would break that, not just be
  // a perf choice.
  for (const channel of channels) {
    await runOneFire(channel, event, env)
  }
}

async function runOneFire(
  channel: string,
  event: ScheduledController,
  env: Env,
): Promise<void> {
  // [LAW:dataflow-not-control-flow] Two phase-scoped catches (select vs
  // execute) because the available context differs by phase, not because the
  // handling differs — the select phase has no recipe to log, the execute
  // phase does. A single catch over both phases would either lose the recipe
  // context on execute failures or require an undefined-tracker on the recipe
  // variable, both worse than the two-phase split.
  let recipe: ChooserOutput
  try {
    const recent = await getRecentRecipes(env, RECENT_WINDOW)
    // [LAW:single-enforcer] realProviders is the gate: in prod
    // (env.SLOPSPOT_ENV === 'prod') only kind: 'real' providers are picked;
    // in dev, mocks remain selectable so the local cron can fire for free.
    // listProviders() (unfiltered) is reserved for getProvider/render paths
    // that need to resolve legacy stored mock providerIds.
    const providers = realProviders(env)
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
    // Workers log + metric are the only record this fire happened. Worker
    // stays alive for the next channel and the next tick either way.
    console.error(
      'firehose.scheduled: recipe selection failed',
      { scheduledTime: event.scheduledTime, channel },
      err,
    )
    emit('slopspot.firehose.fire', { channel, outcome: 'skipped-error' }, 1)
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
      channel,
      providerId: recipe.providerId,
      styleFamily: recipe.styleFamily,
      subjectTemplate: recipe.subject.subjectTemplate,
      aspectRatio: recipe.aspectRatio,
    })
    emit('slopspot.firehose.fire', { channel, outcome: 'fired' }, 1)
  } catch (err) {
    // [LAW:no-defensive-null-guards] This catch is at a trust boundary — the
    // Workers scheduled handler. createPost has already persisted the failure
    // as a 'failed' generations row (its own try/catch owns that), so the row
    // is the source of truth for "what happened." We catch here only to keep
    // the worker alive across channels; re-throwing would abort the scheduled
    // invocation and lose remaining channels.
    // [LAW:no-silent-fallbacks] Log the raw error as a separate argument so
    // Workers' log renderer preserves the stack trace; collapsing to
    // `err.message` here would drop the most useful diagnostic.
    console.error(
      'firehose.scheduled: createPost threw',
      {
        channel,
        providerId: recipe.providerId,
        styleFamily: recipe.styleFamily,
        subjectTemplate: recipe.subject.subjectTemplate,
        aspectRatio: recipe.aspectRatio,
      },
      err,
    )
    emit('slopspot.firehose.fire', { channel, outcome: 'skipped-error' }, 1)
  }
}
