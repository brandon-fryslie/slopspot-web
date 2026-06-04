import { describe, expect, it } from 'vitest'
import { PostId } from '~/lib/domain'
import type { FitnessCandidate } from '~/db/genepool'
import { FOUNDER_RATE, selectReproduction } from '~/firehose/select'

// [LAW:behavior-not-structure] These assert the CONTRACT of the selection fold — what it
// decides, not how it loops: blessed bloodlines breed, buried lines die by non-selection,
// a starved pool founders, novelty injects at the surfaced rate, and the decision is a
// reproducible function of (snapshot, seed). The fold is pure, so a wide sweep of integer
// seeds exercises its distribution deterministically with no clock or RNG.

const cand = (ref: string, fitness: number): FitnessCandidate => ({ ref: PostId(ref), fitness })

// Drive the fold across a deterministic sweep of seeds and tally the outcomes. A pure
// function over many seeds IS its distribution — no Math.random, no flake.
const SEEDS = Array.from({ length: 4000 }, (_, i) => i)
function tally(candidates: readonly FitnessCandidate[]) {
  let founders = 0
  const asParent = new Map<string, number>()
  for (const seed of SEEDS) {
    const plan = selectReproduction(candidates, seed)
    if (plan.kind === 'founder') {
      founders++
      continue
    }
    for (const ref of plan.parents) asParent.set(ref, (asParent.get(ref) ?? 0) + 1)
  }
  return { founders, breds: SEEDS.length - founders, asParent }
}

describe('selectReproduction — the firehose reproduction fold', () => {
  it('founds on every seed when the pool is empty (the bootstrap is the data, not a branch)', () => {
    for (const seed of SEEDS.slice(0, 200)) {
      expect(selectReproduction([], seed)).toEqual({ kind: 'founder' })
    }
  })

  it('founds on every seed when fewer than two genomes are positively selected', () => {
    // One blessed genome, the rest buried — no breedable pair exists.
    const pool = [cand('a', 10), cand('b', 0), cand('c', -5)]
    for (const seed of SEEDS.slice(0, 200)) {
      expect(selectReproduction(pool, seed)).toEqual({ kind: 'founder' })
    }
  })

  it('breeds at ~ (1 - FOUNDER_RATE) and founds at ~ FOUNDER_RATE when a pair exists', () => {
    const { founders, breds } = tally([cand('a', 5), cand('b', 5), cand('c', 5)])
    const founderFraction = founders / SEEDS.length
    // Steady novelty: independent of fitness mass, the rate tracks the surfaced constant.
    expect(founderFraction).toBeGreaterThan(FOUNDER_RATE - 0.05)
    expect(founderFraction).toBeLessThan(FOUNDER_RATE + 0.05)
    expect(breds).toBeGreaterThan(0)
  })

  it('never selects a buried (fitness <= 0) genome as a parent', () => {
    const { asParent } = tally([cand('blessed1', 8), cand('blessed2', 6), cand('zero', 0), cand('buried', -3)])
    expect(asParent.get('zero')).toBeUndefined()
    expect(asParent.get('buried')).toBeUndefined()
    expect((asParent.get('blessed1') ?? 0) + (asParent.get('blessed2') ?? 0)).toBeGreaterThan(0)
  })

  it('preferentially breeds the blessed bloodline — higher fitness reproduces more', () => {
    const { asParent } = tally([cand('blessed', 40), cand('mid', 8), cand('faint', 2)])
    const blessed = asParent.get('blessed') ?? 0
    const faint = asParent.get('faint') ?? 0
    // Fitter genomes are chosen as parents far more often than faint ones.
    expect(blessed).toBeGreaterThan(faint * 2)
  })

  it('never crosses a slop with itself — bred parents are always distinct', () => {
    const pool = [cand('a', 5), cand('b', 5), cand('c', 5)]
    for (const seed of SEEDS) {
      const plan = selectReproduction(pool, seed)
      if (plan.kind === 'bred') expect(plan.parents[0]).not.toBe(plan.parents[1])
    }
  })

  it('is a reproducible function of (snapshot, seed)', () => {
    const pool = [cand('a', 7), cand('b', 3), cand('c', 11)]
    for (const seed of SEEDS.slice(0, 500)) {
      expect(selectReproduction(pool, seed)).toEqual(selectReproduction(pool, seed))
    }
  })
})
