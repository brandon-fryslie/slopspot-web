// [LAW:single-enforcer] The ONE crossover fold — the only place two genomes become a third.
// `bred` reproduction (sexual, two parents) lives here; `founder` (the firehose seeds fresh) and
// `single` (fork, asexual) are constructed elsewhere. The human Breeding Room and the L3 roomless
// chooser both call THIS — they differ only in where the `seed` comes from (crypto-random per
// breed vs. a scheduled-time hash), never in the fold.
//
// [LAW:types-are-the-program] The pure heredity that a deterministic blend CAN fold lives here;
// the UTTERANCE — the one part the composer must author so the earnestness lever can move the
// words — does NOT. So this returns `BredGenome`, not `Genome`: a genome-shaped value with no
// utterance field, which makes a placeholder-utterance genome unrepresentable. The composer
// authors the missing soft tissue from a breed occasion.
//
// [LAW:one-way-deps] Pure leaf above `domain` (types) and `hash` (determinism): no env, no I/O,
// no clock, no votes, no ambient randomness. Same (a, b, seed) → same child, every time.

import type { Genes, Genome, Lineage, TraitVector } from '~/lib/domain'
import { unitFloat } from '~/lib/hash'

// [LAW:types-are-the-program] The crossover result — exactly the parts heredity folds
// DETERMINISTICALLY. No utterance (the composer authors it), no id/render/status (those are
// minted/measured at the post-write boundary, not by the fold). `lineage` is narrowed to the
// `bred` arm by construction: this fold can only ever produce a two-parent cross.
export type BredGenome = {
  genes: Genes
  traits: TraitVector
  lineage: Extract<Lineage, { kind: 'bred' }>
}

// [LAW:no-defensive-null-guards] clamp01 is the CONSTRUCTOR of an in-[0,1] value, not a guard
// bolted after the fact. `lerp` of two [0,1] values stays in [0,1]; `drift` can push past a pole;
// clamping is how the recombined trait is MADE legal. L1's strict `traitVectorSchema` is the
// read-proof boundary (a bred genome round-trips through it), so there is no re-validation here —
// adding one would be the defensive guard the law forbids.
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

// The per-cross mutation rate — the single knob. Drift is a symmetric ±DRIFT_MAX nudge on each
// recombined trait, letting a bloodline wander past the segment between its parents (so a child
// can be MORE austere than either parent, not merely between them). Surfaced, not buried;
// tunable after the earnestness soul-test if drift overwhelms or starves the lever.
const DRIFT_MAX = 0.1

// [LAW:types-are-the-program] The crossover fold. ONE seed in, the whole inheritance pattern out —
// a pure function of it. The seed is kind-tagged per dimension (`gene:species:…`, `mix:curse:…`,
// `drift:earnestness:…`) so each gene's coin and each trait's mix/drift sample UNCORRELATED from
// the same number — a child's species inheritance never constrains its form, and (D2) each trait
// axis recombines independently, so a bloodline can pull earnestness toward the face without
// dragging austerity/curse/density along.
export function breed(a: Genome, b: Genome, seed: number): BredGenome {
  // [LAW:types-are-the-program] CROSSOVER PURITY by construction: each gene is LITERALLY one
  // parent's allele — the coin selects between `a.genes.X` and `b.genes.X`, so the result can
  // only ever be a value one parent already held. `child.gene === a.gene || child.gene === b.gene`
  // is not asserted; it is the only thing the expression can produce. Crossing species or medium
  // is what makes a hybrid (one parent's form through the other's species/medium) — the radiation
  // the Genome exists for.
  // [LAW:types-are-the-program] The per-dimension discriminator (gene name / axis) goes LAST in
  // the tag, NOT in the middle with a shared `:${seed}` suffix. FNV-1a re-processing identical
  // trailing bytes through the same xor-multiply steps partially RE-CORRELATES two streams that
  // diverged earlier (a measurable cross-stream r the decorrelation tests catch); diverging at the
  // final bytes lets the avalanche separate them cleanly. Same seed → same tags → same draws.
  const heads = (gene: string): boolean => unitFloat(`gene:${seed}:${gene}`) < 0.5
  const genes: Genes = {
    species: heads('species') ? a.genes.species : b.genes.species,
    form: heads('form') ? a.genes.form : b.genes.form,
    frame: heads('frame') ? a.genes.frame : b.genes.frame,
    medium: heads('medium') ? a.genes.medium : b.genes.medium,
  }

  // [LAW:dataflow-not-control-flow] Per-axis recombination is one expression applied to each axis
  // name — no branch per trait. `mix` is an independent [0,1) blend position; `drift` an
  // independent symmetric nudge; `clamp01` lands the sum in-bounds.
  const recombine = (axis: keyof TraitVector): number => {
    const mix = unitFloat(`mix:${seed}:${axis}`)
    const drift = (unitFloat(`drift:${seed}:${axis}`) - 0.5) * 2 * DRIFT_MAX
    return clamp01(lerp(a.traits[axis], b.traits[axis], mix) + drift)
  }
  const traits: TraitVector = {
    austerity: recombine('austerity'),
    curse: recombine('curse'),
    density: recombine('density'),
    earnestness: recombine('earnestness'),
  }

  // [LAW:types-are-the-program] The child IS the edge — two of them. The `bred` 2-tuple makes
  // illegal arities (0/1/3+ parents on a cross) unrepresentable. `createPost` already folds this
  // to two `lineage_edges` rows; `feed.ts` already reads edge-count-2 back to `bred`. The fold
  // only constructs the value.
  const lineage: Extract<Lineage, { kind: 'bred' }> = { kind: 'bred', parents: [a.id, b.id] }

  return { genes, traits, lineage }
}
