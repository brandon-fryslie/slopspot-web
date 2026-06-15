// [LAW:behavior-not-structure] These tests pin the founder trait sampler's CONTRACT as behavior a
// blind reader of slopspot-genome-fby / slopspot-genome-3un could check — the variety + identity win
// itself, never the sampler's internals (no assertion on the jitter formula, the seed tags, or the
// spread constant):
//   (a) bounds — every sampled axis lands in [0,1] even from pole centers, and round-trips through
//       L1's strict traitVectorSchema (the read-proof boundary a founder genome crosses on next read);
//   (b) determinism — same (center, seed) → identical founder (a fire replays);
//   (c) SPREAD breaks the monoculture — over a seeded simulation of N founder births across the REAL
//       production generator centers, per-axis variance exceeds a floor and NO axis collapses to the
//       0.5 mean that made the live feed one voice. genome-fby's monoculture floor, asserted against
//       production reality (the real centers), not synthetic spread;
//   (d) the center is a real lever — a citizen tuned toward a region of trait-space births measurably
//       shifted toward it vs a neutral citizen (the-cast 'consistent taste' made heritable);
//   (e) RANGE is the thesis (genome-3un) — the three CD-authored generator centers SPAN each axis with
//       a near-extreme on at least one end, and GutterMonk OWNS the austere/sparse VOID pole (lowest
//       austerity AND lowest density). This is the director's directive made checkable;
//   (f) each maker stays in its REGION (genome-3un) — every seeded founder-child from a center is
//       NEAREST its OWN center (Euclidean nearest-centroid in the 4-cube) than any other. This is the
//       'jitter is texture within a region, never a crossing into a neighbor's' proof. Region
//       separation is EUCLIDEAN, NOT per-axis: GutterMonk & Vesper share the sincere pole on purpose
//       (earnestness 0.80 vs 0.88) yet are never confusable because they diverge hard elsewhere.
//
// [LAW:one-source-of-truth] The generator centers are AUTHORED in migration drizzle/0036 (the prod
// writer of personas.traits_json). This suite READS that SQL as its source — it does not re-declare the
// numbers — so a CD retune of the migration is verified here automatically and the two can never drift.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { TraitVector } from '~/lib/domain'
import { traitVectorSchema, NEUTRAL_TRAITS } from '~/lib/traits'
import { founderTraits } from '~/lib/founder-traits'

const AXES: readonly (keyof TraitVector)[] = ['austerity', 'curse', 'density', 'earnestness']

// A spread of seeds the sampler expands deterministically — same Knuth multiplicative spread breed's
// tests use, covering enough of the bitstream that the per-birth scatter is exercised, not one lucky seed.
const SEEDS = Array.from({ length: 600 }, (_, i) => i * 2654435761)

// Source of truth: parse the generator centers out of migration 0036 (the SQL that writes
// personas.traits_json in prod). Every `UPDATE personas SET traits_json = '<json>' WHERE agent_id =
// '<id>'` becomes one entry, validated through the same strict storage-boundary parser the runtime read
// uses — so a malformed/out-of-range center in the migration fails THIS suite, loud.
const MIGRATION_SQL = readFileSync(
  fileURLToPath(new URL('../../../drizzle/0036_generator_trait_centers.sql', import.meta.url)),
  'utf8',
)

const parseCenters = (sql: string): Record<string, TraitVector> => {
  const re = /traits_json\s*=\s*'(\{[^']*\})'\s*WHERE\s+agent_id\s*=\s*'([^']+)'/g
  const out: Record<string, TraitVector> = {}
  for (const m of sql.matchAll(re)) {
    out[m[2]] = traitVectorSchema.parse(JSON.parse(m[1]))
  }
  return out
}

const CENTERS = parseCenters(MIGRATION_SQL)
// The three seeded generators, mapped to their cast names (the-cast.md). Names index the assertions
// below so a reader sees WHICH citizen owns which pole.
const GUTTERMONK = CENTERS['agent:the-aesthete-gen']
const VESPER = CENTERS['agent:the-cursed-one']
const IDRIS = CENTERS['agent:the-concept-critic']
const GENERATOR_CENTERS: readonly TraitVector[] = [GUTTERMONK, VESPER, IDRIS]

// A real spread, not a monoculture: variance ≈ 0 is everything-at-0.5 (the bug). A floor of 0.02 is
// std ≈ 0.14 — a clearly non-degenerate scatter, well above sampling noise and well below what a
// healthy birth-spread produces. The CLAIM is "founders are not all born the same"; this is its bar.
const VARIANCE_FLOOR = 0.02

const variance = (xs: readonly number[]): number => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length
}
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
const dist2 = (a: TraitVector, b: TraitVector): number =>
  AXES.reduce((s, ax) => s + (a[ax] - b[ax]) ** 2, 0)
const nearestCenter = (t: TraitVector): TraitVector =>
  GENERATOR_CENTERS.reduce((best, c) => (dist2(t, c) < dist2(t, best) ? c : best))

describe('migration 0036 is well-formed (centers source of truth)', () => {
  it('declares exactly the three seeded generators', () => {
    expect(GUTTERMONK).toBeDefined()
    expect(VESPER).toBeDefined()
    expect(IDRIS).toBeDefined()
    expect(Object.keys(CENTERS).sort()).toEqual([
      'agent:the-aesthete-gen',
      'agent:the-concept-critic',
      'agent:the-cursed-one',
    ])
  })
})

describe('founderTraits — bounds (gate a)', () => {
  it('lands every axis in [0,1] from any center, even the poles', () => {
    const centers: TraitVector[] = [
      { ...NEUTRAL_TRAITS },
      { austerity: 0, curse: 0, density: 0, earnestness: 0 },
      { austerity: 1, curse: 1, density: 1, earnestness: 1 },
      ...GENERATOR_CENTERS,
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
      const center = GENERATOR_CENTERS[i % GENERATOR_CENTERS.length]
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

describe('founderTraits — RANGE: the centers span each axis (gate e)', () => {
  it('on every axis the three centers span a wide range with a near-extreme on at least one end', () => {
    for (const axis of AXES) {
      const vals = GENERATOR_CENTERS.map((c) => c[axis])
      const lo = Math.min(...vals)
      const hi = Math.max(...vals)
      // SPAN, not a cluster: the three are pulled apart across the axis, not huddled near the mean.
      expect(hi - lo).toBeGreaterThan(0.5)
      // And the span reaches an extreme on at least one end — the breadth includes a real pole, not
      // three timid mid-tones. (Both ends are near-extreme on most axes; one is the floor.)
      expect(lo < 0.25 || hi > 0.75).toBe(true)
    }
  })

  it('GutterMonk OWNS the austere/sparse VOID pole — lowest austerity AND lowest density, near zero', () => {
    // The director's directive made concrete: the pole opposite the baroque-maximalist live feed is no
    // longer empty. GutterMonk is the strict minimum on both austerity and density, and sits near 0.
    for (const axis of ['austerity', 'density'] as const) {
      expect(GUTTERMONK[axis]).toBeLessThan(IDRIS[axis])
      expect(GUTTERMONK[axis]).toBeLessThan(VESPER[axis])
      expect(GUTTERMONK[axis]).toBeLessThan(0.2)
    }
    // And Vesper holds the opposite (baroque/dense) pole — the breadth has both ends staked.
    expect(VESPER.austerity).toBeGreaterThan(0.8)
    expect(VESPER.density).toBeGreaterThan(0.8)
  })
})

describe('founderTraits — each maker stays in its REGION (gate f)', () => {
  it('every seeded founder-child is NEAREST its own center (Euclidean nearest-centroid in 4-space)', () => {
    for (const center of GENERATOR_CENTERS) {
      for (const seed of SEEDS) {
        const child = founderTraits(center, seed)
        // Recognizability: a GutterMonk-child reads as a GutterMonk, never as an Idris or Vesper —
        // the jitter is texture within the region, never a crossing of the perpendicular bisector.
        expect(nearestCenter(child)).toEqual(center)
      }
    }
  })
})
