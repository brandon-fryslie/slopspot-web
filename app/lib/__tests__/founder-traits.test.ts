// [LAW:behavior-not-structure] These tests pin the founder trait sampler's CONTRACT as behavior a
// blind reader of slopspot-genome-fby could check — the variety win itself, never the sampler's
// internals (no assertion on the jitter formula, the seed tags, or the spread constant):
//   (a) bounds — every sampled axis lands in [0,1] even from pole centers, and round-trips through
//       L1's strict traitVectorSchema (the read-proof boundary a founder genome crosses on next read);
//   (b) determinism — same (center, seed) → identical founder (a fire replays);
//   (c) SPREAD breaks the monoculture — over a seeded simulation of N founder births across the REAL
//       production generator centers, per-axis variance exceeds a floor and NO axis collapses to the
//       0.5 mean that made the live feed one voice. This is the ticket's headline acceptance, asserted
//       against production reality (the real centers), not synthetic spread;
//   (d) the center is a real lever — a citizen tuned toward a region of trait-space births measurably
//       shifted toward it vs a neutral citizen (the-cast 'consistent taste' made heritable).

import { describe, expect, it } from 'vitest'
import type { TraitVector } from '~/lib/domain'
import { traitVectorSchema, NEUTRAL_TRAITS } from '~/lib/traits'
import { founderTraits } from '~/lib/founder-traits'

const AXES: readonly (keyof TraitVector)[] = ['austerity', 'curse', 'density', 'earnestness']

// A spread of seeds the sampler expands deterministically — same Knuth multiplicative spread breed's
// tests use, covering enough of the bitstream that the per-birth scatter is exercised, not one lucky seed.
const SEEDS = Array.from({ length: 600 }, (_, i) => i * 2654435761)

// PRODUCTION REALITY (verified against drizzle/): the THREE seeded generator personas
// (the-aesthete-gen, the-concept-critic, the-cursed-one) are NOT touched by migration 0030 — only
// critics/voters are — so every generator sits at the column DEFAULT, flat neutral 0.5. The variance
// test centers on THESE so the floor reflects what prod actually births today: the spread must come
// from the sampler's jitter, because the centers themselves carry none yet. (When CD tunes maker
// traits via SQL, gate (d) proves the births then shift — but gate (c) must hold WITHOUT that.)
const PRODUCTION_GENERATOR_CENTERS: readonly TraitVector[] = [
  { ...NEUTRAL_TRAITS }, // the-aesthete-gen
  { ...NEUTRAL_TRAITS }, // the-concept-critic
  { ...NEUTRAL_TRAITS }, // the-cursed-one
]

// A real spread, not a monoculture: variance ≈ 0 is everything-at-0.5 (the bug). A floor of 0.02 is
// std ≈ 0.14 — a clearly non-degenerate scatter, well above sampling noise and well below what a
// healthy birth-spread produces. The CLAIM is "founders are not all born the same"; this is its bar.
const VARIANCE_FLOOR = 0.02

const variance = (xs: readonly number[]): number => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length
}
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

describe('founderTraits — bounds (gate a)', () => {
  it('lands every axis in [0,1] from any center, even the poles', () => {
    const centers: TraitVector[] = [
      { ...NEUTRAL_TRAITS },
      { austerity: 0, curse: 0, density: 0, earnestness: 0 },
      { austerity: 1, curse: 1, density: 1, earnestness: 1 },
      { austerity: 0.85, curse: 0.15, density: 0.5, earnestness: 0.95 },
    ]
    for (const center of centers) {
      for (const seed of SEEDS) {
        const traits = founderTraits(center, seed)
        for (const axis of AXES) {
          expect(traits[axis]).toBeGreaterThanOrEqual(0)
          expect(traits[axis]).toBeLessThanOrEqual(1)
        }
        // Round-trips through the strict storage-boundary parser — a founder genome is read back
        // through exactly this on the next feed read, so the sampler must produce a legal vector.
        expect(() => traitVectorSchema.parse(traits)).not.toThrow()
      }
    }
  })
})

describe('founderTraits — determinism (gate b)', () => {
  it('same (center, seed) → identical founder, every time', () => {
    const center: TraitVector = { austerity: 0.3, curse: 0.7, density: 0.5, earnestness: 0.2 }
    for (const seed of SEEDS.slice(0, 50)) {
      expect(founderTraits(center, seed)).toEqual(founderTraits(center, seed))
    }
  })
})

describe('founderTraits — spread breaks the monoculture (gate c)', () => {
  it('over N seeded births across the REAL generator centers, every axis spreads above the floor', () => {
    // Simulate N founder fires: each picks a generator center (round-robin over the real roster) and
    // a distinct seed — the firehose's reproducible per-fire scatter.
    const byAxis: Record<keyof TraitVector, number[]> = {
      austerity: [],
      curse: [],
      density: [],
      earnestness: [],
    }
    SEEDS.forEach((seed, i) => {
      const center = PRODUCTION_GENERATOR_CENTERS[i % PRODUCTION_GENERATOR_CENTERS.length]
      const traits = founderTraits(center, seed)
      for (const axis of AXES) byAxis[axis].push(traits[axis])
    })
    for (const axis of AXES) {
      // The headline: births SPREAD — variance is real, not the ≈0 of a monoculture.
      expect(variance(byAxis[axis])).toBeGreaterThan(VARIANCE_FLOOR)
      // And NO axis collapses to ~0.5: the spread genuinely reaches both registers, not a tight
      // cluster at the mean. min well below neutral, max well above it.
      expect(Math.min(...byAxis[axis])).toBeLessThan(0.3)
      expect(Math.max(...byAxis[axis])).toBeGreaterThan(0.7)
    }
  })
})

describe('founderTraits — the persona center is a real lever (gate d)', () => {
  it('a citizen tuned toward a region births measurably shifted toward it vs a neutral citizen', () => {
    // A maker CD has tuned: hard toward baroque (austerity high) and the ironic mask (earnestness low).
    const leaning: TraitVector = { austerity: 0.85, curse: 0.5, density: 0.5, earnestness: 0.15 }
    const sampleAxis = (center: TraitVector, axis: keyof TraitVector): number[] =>
      SEEDS.map((seed) => founderTraits(center, seed)[axis])

    // The TUNED axes shift toward the citizen's region; the UNTUNED axes (curse/density, left neutral)
    // stay centered on neutral — the lever moves only where the citizen leans, by data not branch.
    const neutralAusterity = mean(sampleAxis(NEUTRAL_TRAITS, 'austerity'))
    const leaningAusterity = mean(sampleAxis(leaning, 'austerity'))
    expect(leaningAusterity).toBeGreaterThan(neutralAusterity + 0.1)

    const neutralEarnestness = mean(sampleAxis(NEUTRAL_TRAITS, 'earnestness'))
    const leaningEarnestness = mean(sampleAxis(leaning, 'earnestness'))
    expect(leaningEarnestness).toBeLessThan(neutralEarnestness - 0.1)

    // The untuned axis does NOT drift just because another axis leaned — births stay near neutral.
    const leaningDensity = mean(sampleAxis(leaning, 'density'))
    expect(Math.abs(leaningDensity - 0.5)).toBeLessThan(0.05)
  })
})
