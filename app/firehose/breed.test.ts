// [LAW:behavior-not-structure] These tests pin the breed fold's CONTRACT — the four binding
// gate clauses, as behavior a blind reader of the spec could check, never the fold's internals:
//   (a) crossover purity — every child gene is one parent's allele, and both parents contribute
//       across seeds (the coin is real, not always-A);
//   (b) trait bounds — every recombined trait lands in [0,1] even under extreme parents + drift,
//       and round-trips through L1's strict traitVectorSchema (the read-proof boundary);
//   (c) BredGenome has no utterance — proven at the TYPE level (a `utterance` access is a compile
//       error); the runtime test asserts the shape carries exactly genes + traits + lineage;
//   determinism — same (a, b, seed) → identical child;
//   lineage — { kind:'bred', parents:[a.id, b.id] } in that fixed order.

import { describe, expect, it } from 'vitest'
import { GenomeId, ProviderId, type Genome, type TraitVector } from '~/lib/domain'
import { traitVectorSchema } from '~/lib/traits'
import { breed } from './breed'

// Two parents whose alleles DIFFER on every gene, so "the child took this gene from a parent" is a
// meaningful claim (shared alleles would satisfy purity trivially). Traits at opposite extremes so
// the bounds test exercises the clamp under the widest lerp+drift.
const ALICE: Genome = {
  id: GenomeId('alice'),
  genes: {
    species: 'oil-painting',
    form: { subjectTemplate: 'T00', slots: { freeText: 'alice subject' } },
    frame: '1:1',
    medium: ProviderId('fal-flux'),
  },
  utterance: 'alice utterance',
  traits: { austerity: 0, curse: 0, density: 0, earnestness: 0 },
  lineage: { kind: 'founder' },
}

const BOB: Genome = {
  id: GenomeId('bob'),
  genes: {
    species: 'vaporwave',
    form: { subjectTemplate: 'T00', slots: { freeText: 'bob subject' } },
    frame: '16:9',
    medium: ProviderId('replicate-sdxl'),
  },
  utterance: 'bob utterance',
  traits: { austerity: 1, curse: 1, density: 1, earnestness: 1 },
  lineage: { kind: 'founder' },
}

// A spread of seeds the fold expands deterministically. Covers enough of the bitstream space to
// see both coin faces per gene without depending on any particular seed's outcome.
const SEEDS = Array.from({ length: 200 }, (_, i) => i * 2654435761) // Knuth multiplicative spread

const AXES: readonly (keyof TraitVector)[] = ['austerity', 'curse', 'density', 'earnestness']

describe('breed — crossover purity (gate a)', () => {
  it('inherits every gene WHOLLY from one parent — never a third value', () => {
    for (const seed of SEEDS) {
      const child = breed(ALICE, BOB, seed)
      expect([ALICE.genes.species, BOB.genes.species]).toContain(child.genes.species)
      expect([ALICE.genes.form, BOB.genes.form]).toContain(child.genes.form)
      expect([ALICE.genes.frame, BOB.genes.frame]).toContain(child.genes.frame)
      expect([ALICE.genes.medium, BOB.genes.medium]).toContain(child.genes.medium)
    }
  })

  it('the per-gene coin is REAL — both parents contribute each gene across seeds', () => {
    const speciesSeen = new Set(SEEDS.map((s) => breed(ALICE, BOB, s).genes.species))
    const mediumSeen = new Set(SEEDS.map((s) => breed(ALICE, BOB, s).genes.medium))
    // If the coin were stuck (always-A / always-B), only one allele would ever appear.
    expect(speciesSeen).toEqual(new Set([ALICE.genes.species, BOB.genes.species]))
    expect(mediumSeen).toEqual(new Set([ALICE.genes.medium, BOB.genes.medium]))
  })

  it('genes assort INDEPENDENTLY — species inheritance does not dictate medium (D2 in spirit)', () => {
    // Over the seed spread, all four (species-parent × medium-parent) combinations occur — a single
    // shared coin would only ever produce the two matched corners.
    const combos = new Set(
      SEEDS.map((s) => {
        const c = breed(ALICE, BOB, s)
        return `${c.genes.species}|${c.genes.medium}`
      }),
    )
    expect(combos.size).toBe(4)
  })
})

describe('breed — trait bounds by construction (gate b)', () => {
  it('every recombined trait is in [0,1] under extreme parents + full drift', () => {
    for (const seed of SEEDS) {
      const child = breed(ALICE, BOB, seed)
      for (const axis of AXES) {
        expect(child.traits[axis]).toBeGreaterThanOrEqual(0)
        expect(child.traits[axis]).toBeLessThanOrEqual(1)
      }
    }
  })

  it('the child traits round-trip through L1 strict traitVectorSchema (the read-proof)', () => {
    for (const seed of SEEDS) {
      const child = breed(ALICE, BOB, seed)
      // Throws if any axis is out of [0,1] or the shape is wrong — the same boundary a bred genome
      // crosses on read. No bred child may fail it.
      expect(() => traitVectorSchema.parse(child.traits)).not.toThrow()
    }
  })

  it('traits recombine INDEPENDENTLY per axis (D2) — axes do not move in lockstep', () => {
    // Two identical parents collapse lerp to a no-op, so any spread between axes comes purely from
    // the per-axis drift streams being independent. With one shared drift they'd be identical.
    const flat: Genome = { ...ALICE, traits: { austerity: 0.5, curse: 0.5, density: 0.5, earnestness: 0.5 } }
    const child = breed(flat, flat, 12345)
    const values = AXES.map((a) => child.traits[a])
    expect(new Set(values).size).toBeGreaterThan(1)
  })
})

describe('breed — trait streams DECORRELATE (D2 by evidence)', () => {
  // The gene-coin suffix-correlation bug (gene:species:N vs gene:medium:N) has a twin in the trait
  // streams: mix:{axis}:{seed} and drift:{axis}:{seed} share the :{seed} suffix across all four
  // axes. D2's promise — a bloodline pulls earnestness toward the face WITHOUT dragging austerity/
  // curse/density — is exactly cross-axis decorrelation, and it is invisible to any structural
  // check. This proves it behaviorally: over a seed sample, every pair of axes is ~uncorrelated.

  // Pearson correlation coefficient over paired samples. r→0 under independence; |r|→1 if two axes
  // move together. A constant series (zero variance) cannot correlate — return 0.
  const pearson = (xs: number[], ys: number[]): number => {
    const n = xs.length
    const mx = xs.reduce((s, x) => s + x, 0) / n
    const my = ys.reduce((s, y) => s + y, 0) / n
    let cov = 0
    let vx = 0
    let vy = 0
    for (let i = 0; i < n; i++) {
      const dx = xs[i]! - mx
      const dy = ys[i]! - my
      cov += dx * dy
      vx += dx * dx
      vy += dy * dy
    }
    return vx === 0 || vy === 0 ? 0 : cov / Math.sqrt(vx * vy)
  }

  const CORR_SEEDS = Array.from({ length: 500 }, (_, i) => i * 2654435761)
  // Independence threshold for n=500. True-independent draws give |r| well under this; a shared
  // stream (the bug) drives |r| toward 1. Generous enough to never flake, tight enough to catch
  // lockstep.
  const MAX_ABS_R = 0.2

  const assertAllPairsDecorrelate = (sampleByAxis: Record<keyof TraitVector, number[]>) => {
    for (let i = 0; i < AXES.length; i++) {
      for (let j = i + 1; j < AXES.length; j++) {
        const r = pearson(sampleByAxis[AXES[i]!]!, sampleByAxis[AXES[j]!]!)
        expect(Math.abs(r), `${AXES[i]} vs ${AXES[j]} correlation`).toBeLessThan(MAX_ABS_R)
      }
    }
  }

  it('MIX streams decorrelate — parents at opposite extremes, so output ≈ mix per axis', () => {
    // ALICE all-0, BOB all-1 → child[axis] = clamp01(lerp(0,1,mix)+drift) ≈ mix. Cross-axis
    // correlation of outputs is the cross-axis correlation of the mix draws.
    const sample = { austerity: [], curse: [], density: [], earnestness: [] } as Record<keyof TraitVector, number[]>
    for (const seed of CORR_SEEDS) {
      const child = breed(ALICE, BOB, seed)
      for (const axis of AXES) sample[axis].push(child.traits[axis])
    }
    assertAllPairsDecorrelate(sample)
  })

  it('DRIFT streams decorrelate — identical 0.5 parents, so output ≈ 0.5 + drift per axis', () => {
    // lerp collapses (both parents equal), so child[axis] = clamp01(0.5 + drift). Cross-axis
    // correlation of outputs is the cross-axis correlation of the drift draws.
    const flat: Genome = { ...ALICE, traits: { austerity: 0.5, curse: 0.5, density: 0.5, earnestness: 0.5 } }
    const sample = { austerity: [], curse: [], density: [], earnestness: [] } as Record<keyof TraitVector, number[]>
    for (const seed of CORR_SEEDS) {
      const child = breed(flat, flat, seed)
      for (const axis of AXES) sample[axis].push(child.traits[axis])
    }
    assertAllPairsDecorrelate(sample)
  })
})

describe('breed — lineage + determinism + no-utterance (gates c, determinism, lineage)', () => {
  it('lineage is bred with both parents in [a, b] order', () => {
    const child = breed(ALICE, BOB, 7)
    expect(child.lineage).toEqual({ kind: 'bred', parents: [ALICE.id, BOB.id] })
  })

  it('is deterministic — same (a, b, seed) yields an identical child', () => {
    expect(breed(ALICE, BOB, 999)).toEqual(breed(ALICE, BOB, 999))
  })

  it('carries EXACTLY genes + traits + lineage — no utterance field to stash a placeholder', () => {
    const child = breed(ALICE, BOB, 1)
    expect(Object.keys(child).sort()).toEqual(['genes', 'lineage', 'traits'])
    // The type forbids `child.utterance`; this asserts the runtime shape agrees — the composer is
    // the only author of the child's words.
    expect('utterance' in child).toBe(false)
  })
})
