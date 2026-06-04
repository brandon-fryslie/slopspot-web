// [LAW:single-enforcer] The firehose's reproduction decision — the ONE place the gene pool
// folds into "cross these two parents, or seed a fresh founder." Pure: a function of (the
// fitness snapshot, a seed). No votes read, no clock, no env — the binder reads the snapshot
// (genepool.ts), runs THIS, then loads the chosen parents and breeds. This only decides.
//
// [LAW:dataflow-not-control-flow] Founder-vs-bred is NOT a mode flag. The founder is a
// weighted ALTERNATIVE drawn against breeding at a steady surfaced rate. A pool with fewer
// than two positively-selected genomes yields a zero breed-weight, so the draw resolves to
// founder on the SAME path as steady state — exactly as an empty `recent` window degrades
// the chooser's R-rules to no-ops. There is no "bootstrap" branch; the bootstrap is the data.
//
// [LAW:one-way-deps] Pure leaf over `domain` (PostId), `weighted` (→ hash), and the
// `FitnessCandidate` read-shape (type-only import; no runtime dependency on storage).

import type { FitnessCandidate } from '~/db/genepool'
import type { PostId } from '~/lib/domain'
import { pickWeighted } from '~/lib/weighted'

// [LAW:types-are-the-program] The reproduction decision as a discriminated VALUE the binder
// folds over — never a boolean `shouldBreed` the caller must branch on twice. `bred` is a
// 2-tuple mirroring Lineage.bred: a cross has exactly two parents by construction, illegal
// arities unrepresentable. The parents are post references; the binder loads their full
// genomes and calls breed(). A founder carries nothing — its genes come from the chooser.
export type ReproductionPlan =
  | { kind: 'founder' }
  | { kind: 'bred'; parents: readonly [PostId, PostId] }

// [LAW:no-mode-explosion] The novelty injection rate — the SINGLE surfaced knob. When a
// breedable pair exists, the firehose seeds a fresh founder this fraction of the time and
// breeds otherwise. Fixed rather than derived from the pool's fitness mass ON PURPOSE: novelty
// must stay STEADY as the pool grows fitter (the doc's "so the pool never stagnates"), which a
// mass-proportional founder weight would betray by shrinking. Fitness drives WHICH parents
// breed; this drives only WHETHER to breed. Tunable; never a flag.
export const FOUNDER_RATE = 0.2

// [LAW:types-are-the-program] The fold. Breedable = positively-selected genomes (fitness > 0):
// a non-positive score is a buried line, which "dies out by not being chosen" — it simply
// carries no weight, no guard needed. A breedable pair must exist to cross; when it does not,
// the breed-weight is zero by data and the draw falls to founder. The two parents are drawn
// fitness-weighted WITHOUT replacement (B from the pool minus A), so a slop never crosses with
// itself and fitter genomes reproduce more. Same (candidates, seed) → same plan, every time.
export function selectReproduction(
  candidates: readonly FitnessCandidate[],
  seed: number,
): ReproductionPlan {
  const breedable = candidates.filter((c) => c.fitness > 0)
  const canBreed = breedable.length >= 2

  // [LAW:dataflow-not-control-flow] A two-outcome weighted draw — founder vs bred — at the
  // steady FOUNDER_RATE. `canBreed ? … : 0` is a weight computed FROM the data (pool shape),
  // not a branch that skips the draw: the draw runs identically every time, only the breed
  // weight varies. A starved pool zeroes it and the single draw lands on founder.
  const mode = pickWeighted(
    ['founder', 'bred'] as const,
    [FOUNDER_RATE, canBreed ? 1 - FOUNDER_RATE : 0],
    seed,
    'reproduce',
  )
  if (mode === 'founder') return { kind: 'founder' }

  const a = pickWeighted(breedable, breedable.map((c) => c.fitness), seed, 'parentA')
  const rest = breedable.filter((c) => c.ref !== a.ref)
  const b = pickWeighted(rest, rest.map((c) => c.fitness), seed, 'parentB')

  return { kind: 'bred', parents: [a.ref, b.ref] }
}
