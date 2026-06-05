// [LAW:single-enforcer] The ONE genetic-distance measurement — how far two genomes have drifted
// apart. Pure, PAIRWISE (a, b), and IGNORANT of founders/primordial/lineage: it measures two
// genomes, nothing more. The caller picks the reference — the speciation read-model (genome-9zt.4)
// folds this over the lineage DAG to measure distance from a bloodline's FOUNDER; the divergence
// proof measures distance from the neutral/primordial baseline. Neither concept leaks in here.
//
// [LAW:types-are-the-program] Returns TWO INDEPENDENT measurements, never a combined scalar. The
// doc's speciation rule — "gene-swaps + trait-drift exceed a threshold" — is two dimensions that
// are NOT commensurable (one allele swap is not "worth" some amount of trait drift). A scalar would
// assert a false theorem (that they trade off at a fixed rate) and smuggle the consumer's weighting
// into the measurement. The threshold + any weighting is the consumer's POLICY, at its edge.
// [LAW:variability-at-edges]
//
// [LAW:one-way-deps] Pure leaf over domain (Genome/Genes/TraitVector/RecipeSubject) only — no env,
// no I/O, no registry, no variety policy.

import type { Genes, Genome, RecipeSubject, TraitVector } from '~/lib/domain'

// [LAW:types-are-the-program] Two orthogonal axes of drift: how many of the four genes were
// swapped (a discrete count, gene-granularity) and how far the continuous traits wandered (an L1
// magnitude). Bundling them as one record is the strongest TRUE theorem — both are knowable, their
// combination is not.
export type GeneticDistance = {
  geneMismatches: number // 0..4 — how many of {species, form, frame, medium} differ
  traitDrift: number // 0..4 — L1 distance summed over the four [0,1] trait axes
}

// [LAW:types-are-the-program] The form gene IS (template, slots): same template with different
// slots is a different form (a slot drift is a gene drift). Deep equality over both — but the gene
// still contributes BINARY to the mismatch count (gene-granularity: WHICH genes swapped, not how
// far within a gene). slots values are strings across every variant (vocab tokens or freeText), so
// a flat key/value compare is total.
function formEqual(a: RecipeSubject, b: RecipeSubject): boolean {
  if (a.subjectTemplate !== b.subjectTemplate) return false
  const sa = a.slots as Record<string, string>
  const sb = b.slots as Record<string, string>
  const ka = Object.keys(sa)
  if (ka.length !== Object.keys(sb).length) return false
  return ka.every((k) => sa[k] === sb[k])
}

function geneMismatchCount(a: Genes, b: Genes): number {
  return (
    (a.species === b.species ? 0 : 1) +
    (formEqual(a.form, b.form) ? 0 : 1) +
    (a.frame === b.frame ? 0 : 1) +
    (a.medium === b.medium ? 0 : 1)
  )
}

const TRAIT_AXES = ['austerity', 'curse', 'density', 'earnestness'] as const

function traitL1(a: TraitVector, b: TraitVector): number {
  let sum = 0
  for (const axis of TRAIT_AXES) sum += Math.abs(a[axis] - b[axis])
  return sum
}

// [LAW:types-are-the-program] Symmetric by construction (each component is symmetric); identical
// genomes measure { geneMismatches: 0, traitDrift: 0 }. The utterance and lineage are NOT part of
// the distance — heredity drift is genes + traits; the composed words are a phenotype-side
// rendering, and lineage is the DAG edge, not the genetic content.
export function geneticDistance(a: Genome, b: Genome): GeneticDistance {
  return {
    geneMismatches: geneMismatchCount(a.genes, b.genes),
    traitDrift: traitL1(a.traits, b.traits),
  }
}
