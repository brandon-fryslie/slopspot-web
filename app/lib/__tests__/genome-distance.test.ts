import { describe, expect, it } from 'vitest'
import { geneticDistance } from '~/lib/genome-distance'
import { GenomeId, ProviderId, type Genome, type RecipeSubject, type TraitVector } from '~/lib/domain'
import { NEUTRAL_TRAITS } from '~/lib/traits'

// [LAW:behavior-not-structure] The measurement's contract: gene-granularity Hamming over the four
// genes (form by template+slots deep-eq), L1 over the four trait axes, two INDEPENDENT components,
// symmetric, zero on identity. The threshold that turns this into "speciation" is the consumer's;
// this test never asserts one.

const FORM_A: RecipeSubject = { subjectTemplate: 'T00', slots: { freeText: 'a relic' } }
const FORM_B: RecipeSubject = { subjectTemplate: 'T00', slots: { freeText: 'a tower' } }

const genome = (overrides: Partial<Genome['genes']> & { traits?: TraitVector } = {}): Genome => ({
  id: GenomeId('g'),
  genes: {
    species: overrides.species ?? 'photoreal',
    form: overrides.form ?? FORM_A,
    frame: overrides.frame ?? '1:1',
    medium: overrides.medium ?? ProviderId('fal-flux'),
  },
  utterance: 'ignored by distance',
  traits: overrides.traits ?? NEUTRAL_TRAITS,
  lineage: { kind: 'founder' },
})

describe('geneticDistance', () => {
  it('is zero on identical genomes', () => {
    expect(geneticDistance(genome(), genome())).toEqual({ geneMismatches: 0, traitDrift: 0 })
  })

  it('counts each differing gene once (gene-granularity Hamming, 0..4)', () => {
    expect(geneticDistance(genome(), genome({ species: 'anime' })).geneMismatches).toBe(1)
    expect(geneticDistance(genome(), genome({ frame: '16:9' })).geneMismatches).toBe(1)
    expect(geneticDistance(genome(), genome({ medium: ProviderId('replicate-sdxl') })).geneMismatches).toBe(1)
    expect(
      geneticDistance(
        genome(),
        genome({ species: 'anime', frame: '16:9', medium: ProviderId('replicate-sdxl'), form: FORM_B }),
      ).geneMismatches,
    ).toBe(4)
  })

  it('treats a slot drift as a form gene drift (template+slots deep-eq, but binary contribution)', () => {
    // Same template, different slots → the form gene differs → +1 (not a fractional intra-gene signal).
    expect(geneticDistance(genome({ form: FORM_A }), genome({ form: FORM_B })).geneMismatches).toBe(1)
    // Same template AND same slots → no form drift.
    expect(geneticDistance(genome({ form: FORM_A }), genome({ form: { ...FORM_A } })).geneMismatches).toBe(0)
  })

  it('measures trait drift as L1 over the four axes, independent of gene mismatches', () => {
    const drifted: TraitVector = { austerity: 0.9, curse: 0.5, density: 0.3, earnestness: 0.5 }
    // |0.9-0.5| + 0 + |0.3-0.5| + 0 = 0.4 + 0.2 = 0.6
    const d = geneticDistance(genome(), genome({ traits: drifted }))
    expect(d.traitDrift).toBeCloseTo(0.6, 10)
    expect(d.geneMismatches).toBe(0) // genes identical → trait drift does not leak into gene count
  })

  it('is symmetric', () => {
    const a = genome({ species: 'anime', traits: { austerity: 0.2, curse: 0.8, density: 0.4, earnestness: 0.6 } })
    const b = genome({ frame: '9:16', form: FORM_B })
    expect(geneticDistance(a, b)).toEqual(geneticDistance(b, a))
  })
})
