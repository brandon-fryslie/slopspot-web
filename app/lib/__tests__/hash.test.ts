// [LAW:behavior-not-structure] The hash's CONTRACT is independence: a seed combined with different
// discriminators must yield uncorrelated streams, across every seed distribution the callers use
// (small integers for breed, 13-digit timestamps for the firehose, prefix-sharing strings for
// scheduler agentIds). This is the invariant whose VIOLATION — invisible to any structural check —
// shipped twice as string-concat (discriminator-first re-correlated small breed seeds; seed-first
// re-correlated prefix-sharing agentIds). The property test below locks it by MEASUREMENT, with a
// calibration meta-assertion that the refuted forms (concat either way, XOR) WOULD trip the same
// threshold — so the test has demonstrated teeth, not just a number that happens to pass.

import { describe, expect, it } from 'vitest'
import { seedFloat, seedHash } from '~/lib/hash'

// --- Pearson correlation over paired samples --------------------------------------------------
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let c = 0, vx = 0, vy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx
    const dy = ys[i]! - my
    c += dx * dy; vx += dx * dx; vy += dy * dy
  }
  return vx === 0 || vy === 0 ? 0 : c / Math.sqrt(vx * vy)
}

// A key-builder maps (seed, ...tags) → [0,1). seedFloat is the real one; the calibration builders
// are the refuted string-concat / XOR variants, reconstructed here to prove the threshold catches
// them. Their fnv1a32 is a local copy (the real one is module-internal by design).
type KeyFn = (seed: number, ...tags: string[]) => number
const u32 = (x: number) => x >>> 0
function fnv1a32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}
function fmix32(h: number): number {
  h = u32(h); h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16
  return h >>> 0
}
const concatKindFirst: KeyFn = (seed, ...tags) => fnv1a32([...tags, seed].join(':')) / 0x100000000
const concatSeedFirst: KeyFn = (seed, ...tags) => fnv1a32([seed, ...tags].join(':')) / 0x100000000
const xorCombine: KeyFn = (seed, ...tags) => {
  let t = 0x811c9dc5
  for (const tag of tags) t = fnv1a32(String(t) + ':' + tag)
  return u32(fmix32(seed) ^ t) / 0x100000000
}

// Max |r| over every discriminator pair, across a seed sweep.
function maxPairR(key: KeyFn, seeds: number[], discs: string[][]): number {
  const series = discs.map((d) => seeds.map((s) => key(s, ...d)))
  let m = 0
  for (let i = 0; i < series.length; i++)
    for (let j = i + 1; j < series.length; j++)
      m = Math.max(m, Math.abs(pearson(series[i]!, series[j]!)))
  return m
}

// --- the three caller regimes -----------------------------------------------------------------
const SMALL_INT_SEEDS = Array.from({ length: 500 }, (_, i) => i) // breed
const TIMESTAMP_SEEDS = Array.from({ length: 500 }, (_, i) => 1_700_000_000_000 + i * 47 * 60000) // chooser
const TICK_SEEDS = Array.from({ length: 500 }, (_, i) => 1_700_000_000_000 + i * 60000) // scheduler ticks

const AXIS_DISCS = [['mix', 'austerity'], ['mix', 'curse'], ['mix', 'density'], ['mix', 'earnestness']]
const KIND_DISCS = [['style'], ['aspect'], ['subject'], ['provider']]
const PREFIX_AGENT_DISCS = [['voter-aurelius'], ['voter-aurelia'], ['voter-aurelio'], ['voter-aurelian']]

const REGIMES: { name: string; seeds: number[]; discs: string[][] }[] = [
  { name: 'breed small-int seeds × axes', seeds: SMALL_INT_SEEDS, discs: AXIS_DISCS },
  { name: 'timestamp seeds × chooser kinds', seeds: TIMESTAMP_SEEDS, discs: KIND_DISCS },
  { name: 'scheduler ticks × prefix-sharing agentIds', seeds: TICK_SEEDS, discs: PREFIX_AGENT_DISCS },
]

// True-independent draws give |r| ~ 1/sqrt(500) ≈ 0.045; the combine measures ≤ 0.10. The refuted
// forms reach 0.3–1.0 in at least one regime. 0.15 passes the combine with margin and trips them.
const MAX_ABS_R = 0.15

describe('seedHash/seedFloat — independence (the locked invariant)', () => {
  for (const { name, seeds, discs } of REGIMES) {
    it(`decorrelates discriminators across ${name}`, () => {
      expect(maxPairR(seedFloat, seeds, discs)).toBeLessThan(MAX_ABS_R)
    })
  }

  // [LAW:verifiable-goals] The teeth: each refuted form TRIPS the threshold in at least one regime,
  // so a regression that reverted to string-concat or XOR would fail this test, not pass it.
  it('CALIBRATION — string-concat (both orders) and XOR each trip the threshold somewhere', () => {
    const tripsSomewhere = (key: KeyFn) => REGIMES.some((r) => maxPairR(key, r.seeds, r.discs) >= MAX_ABS_R)
    expect(tripsSomewhere(concatKindFirst)).toBe(true) // discriminator-first: re-correlates breed small seeds
    expect(tripsSomewhere(concatSeedFirst)).toBe(true) // seed-first: re-correlates prefix-sharing agentIds
    expect(tripsSomewhere(xorCombine)).toBe(true) // XOR: disc is a constant offset → r ≈ 1
  })
})

describe('seedHash — combine properties', () => {
  it('is deterministic — same (seed, ...tags) → same hash', () => {
    expect(seedHash(42, 'mix', 'curse')).toBe(seedHash(42, 'mix', 'curse'))
  })

  it('is ORDER-SENSITIVE — tag order changes the hash (collision unconstructible)', () => {
    let collisions = 0
    for (let s = 0; s < 300; s++) if (seedHash(s, 'gene', 'species') === seedHash(s, 'species', 'gene')) collisions++
    expect(collisions).toBe(0)
  })

  it('avalanches a 1-bit seed flip — ~half the output bits change', () => {
    let totalFlipped = 0, samples = 0
    for (let s = 0; s < 64; s++) {
      const base = seedHash(s, 'mix', 'curse')
      for (let b = 0; b < 32; b++) {
        let x = u32(base ^ seedHash(s ^ (1 << b), 'mix', 'curse'))
        let bits = 0
        while (x) { bits += x & 1; x >>>= 1 }
        totalFlipped += bits; samples++
      }
    }
    const frac = totalFlipped / samples / 32
    expect(frac).toBeGreaterThan(0.4)
    expect(frac).toBeLessThan(0.6)
  })

  it('does not collapse to 0 when seed and discriminator coincide', () => {
    let zeros = 0
    for (let s = 0; s < 5000; s++) if (seedHash(s, String(s)) === 0) zeros++
    expect(zeros).toBe(0)
  })

  it('seedFloat stays in [0, 1)', () => {
    for (let s = 0; s < 200; s++) {
      const f = seedFloat(s, 'mix', 'curse')
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThan(1)
    }
  })
})
