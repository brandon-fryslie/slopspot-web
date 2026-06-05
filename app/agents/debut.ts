// [LAW:single-enforcer] The newcomer's DEBUT — a newborn citizen's FIRST act, fired at birth. The Birth
// Engine writes + announces the persona; this is where it FINDS ITS FEET: it makes its first slop so it
// has acted within its first cycle BY CONSTRUCTION (slopspot-growing-cast-7ni.4). A separate module from
// the birth ceremony (midwife.ts) because its seams are the generation pipeline + the budget cap, so it is
// unit-testable against mocked authorSlop/checkBudget the way the firehose's gen-queue is.
//
// [LAW:one-way-deps] midwife → debut → generator.authorSlop. One-way: generator never reaches back here
// (the same direction midwife already depends through parseGeneratorConfig).

import { authorSlop } from '~/agents/generator'
import type { Persona } from '~/agents/persona'
import { checkBudget } from '~/firehose/budget'
import { emit } from '~/observability/metrics'

// [LAW:single-enforcer] The newcomer's first act. TOTAL + ISOLATED, exactly like the welcome: the birth
// (the persona row) is PRIMARY TRUTH and the debut is best-effort, so a budget pause or a provider/write
// failure is OBSERVABLE on slopspot.birth.debut and NEVER propagates as an exception that would un-birth a
// citizen or crash runBirth.
//
// [LAW:one-type-per-behavior] MEDIUM-AGNOSTIC: authorSlop authors a FOUNDER slop (fresh bloodline — correct
// for a lineage-less newcomer making its first piece) in the persona's OWN medium. A verse newcomer debuts
// a poem (createPost's text-arm persists it), an image newcomer debuts an image — the SAME call, no branch
// on medium. The newcomer's first work simply IS whatever its medium produces.
//
// [LAW:single-enforcer] The debut is a REAL generation, so it respects the SAME daily spend cap the
// firehose does — it must not bypass the budget enforcer. Over-budget is a deliberate city-wide pause: the
// debut is SKIPPED OBSERVABLY and the newcomer still acts later via the firehose pool (also budget-gated).
export async function debutNewcomer(env: Env, persona: Persona, scheduledTimeMs: number): Promise<void> {
  const budget = await checkBudget(env)
  if (!budget.withinBudget) {
    emit('slopspot.birth.debut', { outcome: 'skipped-budget' }, 1)
    console.log('[birth] debut skipped — over the daily budget; the newcomer will act via the firehose', {
      displayName: persona.displayName,
    })
    return
  }
  try {
    await authorSlop(env, persona, scheduledTimeMs)
    emit('slopspot.birth.debut', { outcome: 'authored' }, 1)
  } catch (err) {
    // [LAW:no-silent-fallbacks] Born but not yet acted — surfaced loudly on its own signal, never raised.
    emit('slopspot.birth.debut', { outcome: 'failed' }, 1)
    console.error('[birth] debut failed — citizen born but has not yet acted (observable, not an un-birth)', {
      displayName: persona.displayName,
      err,
    })
  }
}
