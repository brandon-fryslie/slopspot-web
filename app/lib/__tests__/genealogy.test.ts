import { describe, expect, it } from 'vitest'
import {
  GENE_SWAP_THRESHOLD,
  TRAIT_DRIFT_THRESHOLD,
  ancestralFounders,
  bloodlineFitness,
  descendants,
  dynasties,
  founders,
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
