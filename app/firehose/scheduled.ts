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

import { pickPersona, type PersonaRole } from '~/agents/persona'
import { runGeneratorPass } from '~/agents/generator'
import { runDiscoveryPass } from '~/agents/discoverer'
import { checkBudget } from '~/firehose/budget'
import { SCHEDULES, chooseFires } from '~/firehose/schedule'
import { emit } from '~/observability/metrics'

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

  // [LAW:dataflow-not-control-flow] Same pipeline per channel via runOneFire →
  // runGeneratorPass. Sequential await is load-bearing for anti-rep: channel B's
  // getRecentRecipes (inside runGeneratorPass) runs after channel A's createPost
  // commits, so A's row sits at recent[0] and R1/R3/R4 push B's recipe away.
  // Parallelizing would break anti-rep silently — it is not just a perf choice.
  for (const channel of channels) {
    await runOneFire(channel, event, env)
  }
}

// [LAW:single-enforcer] runGeneratorPass owns the full pipeline: persona pick,
// recent fetch, chooser, createPost, log. runOneFire is a thin wrapper that
// adds channel metadata to metrics and keeps the worker alive across channels
// on failure. [LAW:no-silent-fallbacks] runGeneratorPass throws on any I/O or
// creation error; the catch here logs + emits without swallowing the root cause.
async function runOneFire(
  channel: string,
  event: ScheduledController,
  env: Env,
): Promise<void> {
  try {
    await runGeneratorPass(env, event.scheduledTime)
    emit('slopspot.firehose.fire', { channel, outcome: 'fired' }, 1)
  } catch (err) {
    console.error(
      'firehose.scheduled: fire failed',
      { channel, scheduledTime: event.scheduledTime },
      err,
    )
    emit('slopspot.firehose.fire', { channel, outcome: 'skipped-error' }, 1)
  }
}

// [LAW:dataflow-not-control-flow] Same orchestration flow for every role:
// pick a persona, dispatch to its action module. The role is the datum that
// selects the action — not a branch that conditionally runs different code.
// Action modules for each role land in downstream tickets (svq.4/svq.5/19s.1).
// The switch is already exhaustive over PersonaRole so tsc-b enforces the gap
// when a new role variant is added without a matching action module.
//
// [LAW:types-are-the-program] `role` is PersonaRole (closed union), not
// `string` — the compiler rejects unknown roles at call sites and forces
// exhaustiveness here.
export async function runAgentPass(
  env: Env,
  scheduledTimeMs: number,
  role: PersonaRole,
): Promise<void> {
  const persona = await pickPersona(env, role, scheduledTimeMs)
  if (persona === null) {
    console.log('agent-pass: no personas for role; skipping', { role })
    return
  }

  console.log('agent-pass: picked persona', {
    role,
    agentId: persona.agentId,
    displayName: persona.displayName,
    scheduledTimeMs,
  })

  // [LAW:types-are-the-program] Exhaustive switch — every PersonaRole variant
  // must have an arm. Action modules that don't exist yet are stub no-ops here;
  // each downstream ticket replaces the stub with a real call.
  switch (role) {
    case 'voter':
      // slopspot-agent-voters-19s.1 will replace this stub.
      break
    case 'discoverer':
      await runDiscoveryPass(env, scheduledTimeMs)
      break
    case 'generator':
      await runGeneratorPass(env, scheduledTimeMs)
      break
  }
}
