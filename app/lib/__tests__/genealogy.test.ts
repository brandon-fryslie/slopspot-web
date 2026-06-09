import { describe, expect, it } from 'vitest'
import {
  GENE_SWAP_THRESHOLD,
  INBREEDING_GENE_EPSILON,
  TRAIT_DRIFT_THRESHOLD,
  ancestralFounders,
  bloodlineFitness,
  descendants,
  dynasties,
  founders,
  generationDepth,
  inbreedingOf,
  speciation,
} from '~/lib/genealogy'
import type { LineageDag } from '~/db/genome-dag'
import { GenomeId, ProviderId, type Genome, type RecipeSubject, type TraitVector } from '~/lib/domain'
import { NEUTRAL_TRAITS } from '~/lib/traits'

// [LAW:behavior-not-structure] The derived read-models' contract over a synthetic DAG: founders are
// 0-parent nodes weighted by descendant count (diamonds counted once); a bred node descends from
// MULTIPLE founders; speciation folds geneticDistance over those founders (OR of two independent
// thresholds, new species = drifted from EVERY root); dynasties are large bloodlines; bloodline
// fitness sums a citizen's votes across a whole line.

const FORM: RecipeSubject = { subjectTemplate: 'T00', slots: { freeText: 'x' } }
const g = (
  id: string,
  o: { species?: string; frame?: string; medium?: string; traits?: TraitVector } = {},
): Genome => ({
  id: GenomeId(id),
  genes: {
    species: (o.species ?? 'photoreal') as Genome['genes']['species'],
    form: FORM,
    frame: (o.frame ?? '1:1') as Genome['genes']['frame'],
    medium: ProviderId(o.medium ?? 'fal-flux'),
  },
  utterance: `u-${id}`,
  traits: o.traits ?? NEUTRAL_TRAITS,
  lineage: { kind: 'founder' },
})

// Build a DAG from nodes + [child, parent] edges.
function makeDag(nodes: Genome[], edges: [string, string][]): LineageDag {
  const nm = new Map(nodes.map((n) => [n.id, n]))
  const parents = new Map<GenomeId, GenomeId[]>()
  const children = new Map<GenomeId, GenomeId[]>()
  const push = (m: Map<GenomeId, GenomeId[]>, k: GenomeId, v: GenomeId) => {
    const list = m.get(k)
    if (list) list.push(v)
    else m.set(k, [v])
  }
  for (const [c, p] of edges) {
    push(parents, GenomeId(c), GenomeId(p))
    push(children, GenomeId(p), GenomeId(c))
  }
  return { nodes: nm, parents, children }
}

describe('genealogy — derived read-models over the lineage DAG', () => {
  it('finds founders (0-parent) and counts descendants, deduping diamonds', () => {
    // F → A, F → B, A → C, B → C  (C is bred from A and B: a diamond under F)
    const dag = makeDag(
      [g('F'), g('A'), g('B'), g('C')],
      [['A', 'F'], ['B', 'F'], ['C', 'A'], ['C', 'B']],
    )
    expect(founders(dag)).toEqual([{ id: GenomeId('F'), descendantCount: 3 }]) // A,B,C — C once
    expect(descendants(dag, GenomeId('F')).size).toBe(3)
    expect(descendants(dag, GenomeId('C')).size).toBe(0) // a leaf
  })

  it('a bred node descends from MULTIPLE ancestral founders (no false single-founder)', () => {
    // F1 and F2 are distinct founders; C is bred from both.
    const dag = makeDag([g('F1'), g('F2'), g('C')], [['C', 'F1'], ['C', 'F2']])
    expect(new Set(ancestralFounders(dag, GenomeId('C')))).toEqual(new Set([GenomeId('F1'), GenomeId('F2')]))
    expect(ancestralFounders(dag, GenomeId('F1'))).toEqual([GenomeId('F1')]) // a founder is its own ancestor
  })

  it('speciates by gene-swaps ALONE (OR threshold; the doc\'s "shares one gene with its founder")', () => {
    // X differs from founder F in 3 of 4 genes, traits neutral → gene-swaps alone cross the line.
    const dag = makeDag(
      [g('F'), g('X', { species: 'anime', frame: '16:9', medium: 'replicate-sdxl' })],
      [['X', 'F']],
    )
    const sp = speciation(dag, GenomeId('X'))
    expect(sp.founders[0]!.distance).toEqual({ geneMismatches: GENE_SWAP_THRESHOLD, traitDrift: 0 })
    expect(sp.isNewSpecies).toBe(true)
  })

  it('speciates by trait-drift ALONE (OR threshold; genes intact)', () => {
    const drifted: TraitVector = { austerity: 1, curse: 1, density: 0.5, earnestness: 0.5 } // L1 from neutral = 1.0?
    // |1-0.5|+|1-0.5| = 1.0 — below 1.5; bump density too:
    const far: TraitVector = { austerity: 1, curse: 1, density: 1, earnestness: 0.5 } // L1 = 1.5
    const dag = makeDag([g('F'), g('Y', { traits: far })], [['Y', 'F']])
    const sp = speciation(dag, GenomeId('Y'))
    expect(sp.founders[0]!.distance.geneMismatches).toBe(0)
    expect(sp.founders[0]!.distance.traitDrift).toBeGreaterThanOrEqual(TRAIT_DRIFT_THRESHOLD)
    expect(sp.isNewSpecies).toBe(true)
    expect(drifted.density).toBe(0.5) // (silence unused) — documents the sub-threshold case
  })

  it('is NOT a new species while still close to ANY ancestral founder', () => {
    // C is far from F1 (3 gene-swaps) but identical to F2 → still close to F2 → not yet a new species.
    const dag = makeDag(
      [g('F1'), g('F2', { species: 'anime', frame: '16:9', medium: 'replicate-sdxl' }), g('C', { species: 'anime', frame: '16:9', medium: 'replicate-sdxl' })],
      [['C', 'F1'], ['C', 'F2']],
    )
    const sp = speciation(dag, GenomeId('C'))
    const byFounder = new Map(sp.founders.map((f) => [f.founder, f]))
    expect(byFounder.get(GenomeId('F1'))!.speciated).toBe(true) // drifted from F1
    expect(byFounder.get(GenomeId('F2'))!.speciated).toBe(false) // identical to F2
    expect(sp.isNewSpecies).toBe(false) // not speciated from EVERY founder
  })

  it('a founder is never its own new species (distance to self is zero)', () => {
    const dag = makeDag([g('F')], [])
    expect(speciation(dag, GenomeId('F')).isNewSpecies).toBe(false)
  })

  it('identifies dynasties (founders with a bloodline past the threshold)', () => {
    // F1 roots a chain of 5 descendants (a dynasty); F2 roots 1 (not).
    const chain: [string, string][] = [['n1', 'F1'], ['n2', 'n1'], ['n3', 'n2'], ['n4', 'n3'], ['n5', 'n4']]
    const dag = makeDag(
      [g('F1'), g('n1'), g('n2'), g('n3'), g('n4'), g('n5'), g('F2'), g('lonely')],
      [...chain, ['lonely', 'F2']],
    )
    const dyn = dynasties(dag)
    expect(dyn.map((d) => d.founder)).toEqual([GenomeId('F1')])
    expect(dyn[0]!.size).toBe(6) // founder + 5 descendants
    expect(new Set(dyn[0]!.bloodline)).toEqual(
      new Set(['F1', 'n1', 'n2', 'n3', 'n4', 'n5'].map(GenomeId)),
    )
  })

  it('sums a citizen\'s votes across a whole bloodline (the intra-niche gradient), diamonds once', () => {
    // F → A, F → B, A → C, B → C. A citizen upvoted F(+1), A(+1), C(+1), downvoted B(-1).
    const dag = makeDag(
      [g('F'), g('A'), g('B'), g('C')],
      [['A', 'F'], ['B', 'F'], ['C', 'A'], ['C', 'B']],
    )
    const votes = new Map([
      [GenomeId('F'), 1],
      [GenomeId('A'), 1],
      [GenomeId('B'), -1],
      [GenomeId('C'), 1],
    ])
    // F's bloodline fitness = F + A + B + C = 1 + 1 - 1 + 1 = 2 (C counted ONCE despite the diamond).
    expect(bloodlineFitness(dag, votes, GenomeId('F'))).toBe(2)
    // A's line = A + C = 2; a leaf C = just C = 1.
    expect(bloodlineFitness(dag, votes, GenomeId('A'))).toBe(2)
    expect(bloodlineFitness(dag, votes, GenomeId('C'))).toBe(1)
  })

  it('degrades to nothing on an empty DAG (the bootstrap is the data)', () => {
    const dag = makeDag([], [])
    expect(founders(dag)).toEqual([])
    expect(dynasties(dag)).toEqual([])
  })
})

describe('inbreeding — the inverse-of-speciation fold over a bred node (genome-p6z.6)', () => {
  const FAR = { species: 'anime', frame: '16:9', medium: 'replicate-sdxl' } // 3 genes off photoreal/1:1/fal-flux

  it('flags a cross whose two parents are identical (distance {0,0} → inbred)', () => {
    // P1 and P2 are the same genome but for id; C is bred from both.
    const dag = makeDag([g('P1'), g('P2'), g('C')], [['C', 'P1'], ['C', 'P2']])
    const ib = inbreedingOf(dag, GenomeId('C'))!
    expect(ib.distance).toEqual({ geneMismatches: 0, traitDrift: 0 })
    expect(ib.inbred).toBe(true)
    expect(new Set(ib.parents)).toEqual(new Set([GenomeId('P1'), GenomeId('P2')]))
  })

  it('does NOT flag a healthy outbred cross (parents far apart on genes)', () => {
    const dag = makeDag([g('P1'), g('P2', FAR), g('C')], [['C', 'P1'], ['C', 'P2']])
    const ib = inbreedingOf(dag, GenomeId('C'))!
    expect(ib.distance.geneMismatches).toBeGreaterThan(INBREEDING_GENE_EPSILON)
    expect(ib.inbred).toBe(false)
  })

  it('AND, not OR — one gene apart but traits driven past the epsilon is NOT inbred', () => {
    // Parents 1 gene apart (close on genes) BUT traits far (L1 = 1.0 > 0.5): the trait axis fails the AND.
    const driftedTraits: TraitVector = { austerity: 1, curse: 1, density: 0.5, earnestness: 0.5 } // L1 from neutral = 1.0
    const dag = makeDag(
      [g('P1'), g('P2', { species: 'anime', traits: driftedTraits }), g('C')],
      [['C', 'P1'], ['C', 'P2']],
    )
    const ib = inbreedingOf(dag, GenomeId('C'))!
    expect(ib.distance.geneMismatches).toBe(1) // within the gene epsilon
    expect(ib.distance.traitDrift).toBeGreaterThan(0.5) // but beyond the trait epsilon
    expect(ib.inbred).toBe(false) // AND fails — a wide trait gap is healthy outbreeding
  })

  it('is undefined (null) for a node that is not a two-parent cross', () => {
    // A founder and a single-parent (asexual) node have no pair to measure.
    const dag = makeDag([g('F'), g('S')], [['S', 'F']])
    expect(inbreedingOf(dag, GenomeId('F'))).toBeNull() // founder
    expect(inbreedingOf(dag, GenomeId('S'))).toBeNull() // single parent
  })
})

describe('generationDepth — longest path to any founder (the decision-locked depth)', () => {
  it('a founder is depth 0', () => {
    expect(generationDepth(makeDag([g('F')], []), GenomeId('F'))).toBe(0)
  })

  it('counts the LONGEST path up a chain', () => {
    const dag = makeDag(
      [g('F'), g('A'), g('B'), g('C')],
      [['A', 'F'], ['B', 'A'], ['C', 'B']],
    )
    expect(generationDepth(dag, GenomeId('C'))).toBe(3)
  })

  it('takes the LONGEST (not shortest) path when a bred node has paths of different lengths', () => {
    // F → A → D, and F → D directly. D is reachable at depth 1 (via F) and depth 2 (via A) → depth 2.
    const dag = makeDag([g('F'), g('A'), g('D')], [['A', 'F'], ['D', 'A'], ['D', 'F']])
    expect(generationDepth(dag, GenomeId('D'))).toBe(2)
  })
})
