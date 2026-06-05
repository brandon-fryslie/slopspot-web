import { describe, expect, it } from 'vitest'
// Side-effect import: register the real providers so realProviders() yields the medium allele-set.
import '~/providers'
import { realProviders } from '~/providers'
import { chooseNextGeneration } from '~/firehose/chooseNextGeneration'
import { breed } from '~/firehose/breed'
import { geneticDistance } from '~/lib/genome-distance'
import { PRIMORDIAL_ALLELES } from '~/lib/variety'
import { seedFloat, seedHash } from '~/lib/hash'
import { NEUTRAL_TRAITS } from '~/lib/traits'
import { GenomeId, type Genome } from '~/lib/domain'

// [LAW:verifiable-goals] THE machine-verifiable acceptance for "variety.ts is the primordial gene
// pool and the pool evolves itself." Not "it runs" — this seeds founders that draw from
// PRIMORDIAL_ALLELES, runs the REAL breed() fold over generations, and asserts the evolved pool has
// DIVERGED from the primordial: hybrid gene-tuples no founder carried, and trait vectors that
// wandered away from neutral and keep wandering with depth. Pure + seeded: a deterministic
// simulation of evolution, no D1, no network, no clock.

const env = {} as Env
const PROVIDERS = realProviders(env) // the medium allele-set, registry-owned

// A founder draws its genes through the actual founder path (the chooser over an empty window),
// which samples species/form/frame from PRIMORDIAL_ALLELES and stamps the provider as the medium.
// Neutral traits — a founder seeds no drift (the firehose's contract); drift arrives by breeding.
function founder(i: number, baseSeed: number): Genome {
  const provider = PROVIDERS[i % PROVIDERS.length]!
  const recipe = chooseNextGeneration({
    scheduledTimeMs: seedHash(baseSeed, 'founder', String(i)),
    recent: [],
    provider,
  })
  return {
    id: GenomeId(`f${i}`),
    genes: { species: recipe.styleFamily, form: recipe.subject, frame: recipe.aspectRatio, medium: recipe.providerId },
    utterance: `founder-${i}`,
    traits: NEUTRAL_TRAITS,
    lineage: { kind: 'founder' },
  }
}

// Wrap breed()'s BredGenome (genes/traits/lineage) back into a Genome so it can re-enter the pool
// as a parent next generation — this is how dynasties deepen and traits accumulate drift.
function generation(pop: readonly Genome[], g: number, baseSeed: number): Genome[] {
  return pop.map((_, k) => {
    const s = seedHash(baseSeed, 'gen', String(g), String(k))
    const ai = Math.floor(seedFloat(s, 'a') * pop.length)
    const bi = ai === Math.floor(seedFloat(s, 'b') * pop.length)
      ? (ai + 1) % pop.length
      : Math.floor(seedFloat(s, 'b') * pop.length)
    const child = breed(pop[ai]!, pop[bi]!, s)
    return {
      id: GenomeId(`g${g}-${k}`),
      genes: child.genes,
      utterance: `g${g}-${k}`,
      traits: child.traits,
      lineage: child.lineage,
    }
  })
}

const NEUTRAL_REF: Genome = { ...founder(0, 0), traits: NEUTRAL_TRAITS }
const driftFromNeutral = (g: Genome) => geneticDistance(g, NEUTRAL_REF).traitDrift
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const tupleOf = (g: Genome) => `${g.genes.species}|${g.genes.frame}|${g.genes.medium}`

const BASE_SEED = 20260604
const NUM_FOUNDERS = 8
const GENERATIONS = 6

function evolve() {
  const founders = Array.from({ length: NUM_FOUNDERS }, (_, i) => founder(i, BASE_SEED))
  const byGen: Genome[][] = [founders]
  let pop: Genome[] = founders
  for (let g = 1; g <= GENERATIONS; g++) {
    pop = generation(pop, g, BASE_SEED)
    byGen.push(pop)
  }
  return { founders, byGen, all: byGen.flat() }
}

describe('the primordial gene pool evolves itself — divergence proof', () => {
  it('founders draw their genes from PRIMORDIAL_ALLELES (the founding pool), with neutral traits', () => {
    const species = new Set<string>(PRIMORDIAL_ALLELES.species)
    const forms = new Set<string>(PRIMORDIAL_ALLELES.form)
    const frames = new Set<string>(PRIMORDIAL_ALLELES.frame)
    const media = new Set(PROVIDERS.map((p) => p.id as string))

    for (const f of Array.from({ length: NUM_FOUNDERS }, (_, i) => founder(i, BASE_SEED))) {
      expect(species.has(f.genes.species)).toBe(true)
      expect(forms.has(f.genes.form.subjectTemplate)).toBe(true)
      expect(frames.has(f.genes.frame)).toBe(true)
      expect(media.has(f.genes.medium)).toBe(true)
      expect(driftFromNeutral(f)).toBe(0) // a founder seeds no drift — the baseline
    }
  })

  it('breeding produces HYBRID gene-tuples no founder carried (recombination beyond the primordial)', () => {
    const { founders, all } = evolve()
    const founderTuples = new Set(founders.map(tupleOf))
    const hybrids = all.filter((g) => !founderTuples.has(tupleOf(g)))
    // Crossover recombines founder alleles into (species, frame, medium) combinations that no single
    // founder had — the "hybrids no one hand-defined."
    expect(hybrids.length).toBeGreaterThan(0)
  })

  it('traits WANDER from neutral and keep wandering with depth (continuous drift accumulates)', () => {
    const { byGen } = evolve()
    const gen1Drift = byGen[1]!.map(driftFromNeutral)
    const lastDrift = byGen[GENERATIONS]!.map(driftFromNeutral)

    // Some drift exists by gen 1 (founders are neutral; their children are not).
    expect(Math.max(...gen1Drift)).toBeGreaterThan(0)
    // The random walk carries traits FURTHER from neutral as generations stack — the evolved pool
    // is provably more drifted than the first bred generation, not merely "non-neutral once."
    expect(mean(lastDrift)).toBeGreaterThan(mean(gen1Drift))
    // And the population genuinely varies (it did not collapse to a single drifted point).
    const variance = mean(lastDrift.map((d) => (d - mean(lastDrift)) ** 2))
    expect(variance).toBeGreaterThan(0)
  })

  it('the evolved pool is genetically distant from the primordial founders (it has diverged)', () => {
    const { founders, byGen } = evolve()
    const last = byGen[GENERATIONS]!
    // Every deep genome's nearest-founder distance: at least one deep genome has BOTH a gene swap
    // and trait drift relative to every founder — it is no founder, and no founder's near-clone.
    const distantfromAllFounders = last.some((g) => {
      const dists = founders.map((f) => geneticDistance(g, f))
      const minGene = Math.min(...dists.map((d) => d.geneMismatches))
      const minTrait = Math.min(...dists.map((d) => d.traitDrift))
      return minGene > 0 && minTrait > 0
    })
    expect(distantfromAllFounders).toBe(true)
  })
})
