import { runPortraitPass } from '~/agents/portrait'
import { runRite } from '~/agents/rite'
import { runBirth } from '~/agents/midwife'
import { runGrace } from '~/agents/grace'
import { maybeDecreeFirstPoet } from '~/agents/firstPoet'
import { measureTraitSpread } from '~/agents/traitSpread'

// [LAW:one-source-of-truth] Single ordered list of daily ceremonies. The dispatch
// in workers/app.ts, the in-isolate tests, and the staging actuator all read this
// one array. Adding a ceremony = one entry here; the CeremonyName union follows.
// Order is the canonised daily sequence — birth precedes first-poet because
// maybeDecreeFirstPoet reads the row runBirth wrote within the same invocation.
export const CEREMONIES = [
  { name: 'portrait' as const, run: runPortraitPass },
  { name: 'rite' as const, run: runRite },
  { name: 'birth' as const, run: runBirth },
  { name: 'grace' as const, run: runGrace },
  { name: 'first-poet' as const, run: (env: Env, _: number) => maybeDecreeFirstPoet(env) },
  // The daily breadth reading. Pure observation (reads score + traits, emits the spread, logs a
  // collapse) — order-independent of the acts above, so it sits last; nothing reads what it writes.
  { name: 'trait-spread' as const, run: measureTraitSpread },
] satisfies readonly { name: string; run: (env: Env, scheduledTimeMs: number) => Promise<unknown> }[]

export type CeremonyName = typeof CEREMONIES[number]['name']
