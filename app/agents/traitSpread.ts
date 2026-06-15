// [LAW:single-enforcer] The ONE emitter of slopspot.trait.spread. The daily breadth reading: it reads
// every succeeded generation's trait vector + score (app/db/trait-spread), computes the
// generated-vs-surviving dispersion (app/lib/trait-spread), and emits one sample per (cohort, axis).
//
// [LAW:effects-at-boundaries] The whole act is read → pure compute → emit: D1 at the front edge, the
// metric at the back edge, the dispersion math pure in between. This module only wires those three;
// it decides nothing the pure core doesn't.
//
// [LAW:no-silent-failure] When the makers' void range exists but the surviving cohort has eaten it
// (isCollapsing), this logs LOUD — the [metric]→VM puller does not exist yet (efficiency-a5w.7), so
// Workers Logs is the surface a human/alert actually sees, and a buried collapse is exactly the
// silent regression genome-3un would die to.

import { readScoredGenerationTraits } from '~/db/trait-spread'
import { buildSpreadReport, isCollapsing, type TraitCohort } from '~/lib/trait-spread'
import { TRAIT_AXES } from '~/lib/traits'
import { emit } from '~/observability/metrics'

const COHORTS: readonly TraitCohort[] = ['generated', 'surviving']

export async function measureTraitSpread(env: Env, _scheduledTimeMs: number): Promise<void> {
  const rows = await readScoredGenerationTraits(env)
  const report = buildSpreadReport(rows)

  // [LAW:dataflow-not-control-flow] Same emit for every cohort×axis; the spread VALUE varies, not
  // whether the emit runs. An empty DB emits zeros (honest "no dispersion observed"), not a skip.
  for (const cohort of COHORTS) {
    for (const axis of TRAIT_AXES) {
      emit('slopspot.trait.spread', { cohort, axis }, report.spread[cohort][axis])
    }
  }

  if (isCollapsing(report)) {
    console.warn('[trait-spread] SURVIVING RANGE COLLAPSING — selection is burying the void pole', {
      counts: report.counts,
      generated: report.spread.generated,
      surviving: report.spread.surviving,
      retention: report.retention,
    })
  }
}
