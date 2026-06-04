// [LAW:single-enforcer] The firehose's niche-pick — the ONE place a fire chooses WHOSE taste
// shapes it. Each breed fire happens within one niche; this picks it, deterministically by
// scheduled time (reproducible, like pickPersona). The pure choice (chooseNiche) is separated
// from the read (pickNiche) so the weighting — including the crowd guard — is unit-testable.
//
// [LAW:dataflow-not-control-flow] The pick is a weighted draw, never a mode flag. Niches compete
// by SELECTION ACTIVITY: an active critic exerts more pressure and radiates more. The crowd (the
// populist) is ONE peer niche whose pick weight is normalized to citizen scale — the mean citizen
// activity, NEVER the raw human vote volume. Humans vote far more than any citizen, so weighting
// the populist by its own volume would let consensus dominate the breed-pick and re-import the
// monoculture the per-niche design forbids; deriving its weight from citizen activity makes that
// domination structurally impossible (CD's "the crowd is one niche among many, never THE fitness").

import { getCitizenVoteCounts, type Niche } from '~/db/genepool'
import { listPersonas } from '~/agents/persona'
import { pickWeighted } from '~/lib/weighted'

// [LAW:no-mode-explosion] The single surfaced floor weight: every niche carries at least this much
// pick weight regardless of activity, so a city with no votes yet draws niches uniformly (and the
// empty pool then founds) rather than dividing by a zero total. Activity adds on top.
export const NICHE_BASE_WEIGHT = 1

// [LAW:types-are-the-program] The pure niche-pick fold. `citizens` are the cast voter agentIds;
// `activity` maps each to its vote count (a missing entry = zero). Each citizen is a niche weighted
// BASE + its activity; the populist is one peer weighted BASE + the MEAN citizen activity — the
// crowd as a single average voice, its own volume structurally absent from the weight. Same
// (citizens, activity, seed) → same niche, every time.
export function chooseNiche(
  citizens: readonly string[],
  activity: ReadonlyMap<string, number>,
  seed: number,
): Niche {
  const citizenActivity = citizens.map((id) => activity.get(id) ?? 0)
  const meanCitizenActivity =
    citizens.length > 0 ? citizenActivity.reduce((s, a) => s + a, 0) / citizens.length : 0

  const populist: Niche = { kind: 'populist', citizenVoterIds: citizens }
  const niches: Niche[] = [...citizens.map((id): Niche => ({ kind: 'citizen', voterId: id })), populist]
  const weights = [
    ...citizenActivity.map((a) => NICHE_BASE_WEIGHT + a),
    NICHE_BASE_WEIGHT + meanCitizenActivity,
  ]

  return pickWeighted(niches, weights, seed, 'niche')
}

// [LAW:single-enforcer] Read the cast (voter personas) + their selection activity, then choose.
// The populist's citizenVoterIds carries the full cast so getNicheGenePool can exclude them from
// the human aggregate. Always returns a niche (the populist exists even with no cast), so the
// caller never branches on absence.
export async function pickNiche(env: Env, scheduledTimeMs: number): Promise<Niche> {
  const voters = await listPersonas(env, 'voter')
  const citizens = voters.map((v) => v.agentId as string)
  const activity = await getCitizenVoteCounts(env, citizens)
  return chooseNiche(citizens, activity, scheduledTimeMs)
}
