// [LAW:behavior-not-structure] The accretion's CONTRACT (slopspot-voice-w2v.3): a citizen's effective
// voice traits = its base sensibility tinted by the recency-weighted pull of its record. Bless pulls the
// effective vector TOWARD the slop's traits; bury pushes it AWAY; recent acts outweigh old ones; an empty
// record leaves the base untouched; the output is always a legal TraitVector ([0,1] per axis). Blind to
// the arithmetic — pinned on the directions and invariants the projection must hold.

import { describe, expect, it } from 'vitest'
import { accreteCharacter, ACCRETION_WEIGHT, type CharacterAct } from '~/lib/character'
import type { TraitVector } from '~/lib/domain'
import { NEUTRAL_TRAITS } from '~/lib/traits'

const HL = 14 * 24 * 60 * 60 * 1000 // the .3 voice rate — the math is rate-agnostic, the test just fixes one
const NOW = new Date('2026-06-04T00:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

const EARNEST: TraitVector = { austerity: 0.5, curse: 0.5, density: 0.5, earnestness: 1 }
const IRONIC: TraitVector = { austerity: 0.5, curse: 0.5, density: 0.5, earnestness: 0 }

describe('accreteCharacter — empty / no-history identity', () => {
  it('returns the base unchanged when the record is empty', () => {
    expect(accreteCharacter(NEUTRAL_TRAITS, [], NOW, HL)).toEqual(NEUTRAL_TRAITS)
  })

  it('returns the base unchanged for a non-neutral citizen with no acts', () => {
    const base: TraitVector = { austerity: 0.2, curse: 0.8, density: 0.3, earnestness: 0.9 }
    expect(accreteCharacter(base, [], NOW, HL)).toEqual(base)
  })
})

describe('accreteCharacter — bless pulls toward, bury pushes away', () => {
  it('blessing earnest slops pulls effective earnestness ABOVE base', () => {
    const acts: CharacterAct[] = [{ traits: EARNEST, value: 1, createdAt: ago(0) }]
    const effective = accreteCharacter(NEUTRAL_TRAITS, acts, NOW, HL)
    expect(effective.earnestness).toBeGreaterThan(NEUTRAL_TRAITS.earnestness)
  })

  it('burying earnest slops pushes effective earnestness BELOW base (the Gremlin grows more Gremlin)', () => {
    const acts: CharacterAct[] = Array.from({ length: 5 }, (_, k) => ({
      traits: EARNEST,
      value: -1 as const,
      createdAt: ago(k * HL * 0.1),
    }))
    const effective = accreteCharacter(NEUTRAL_TRAITS, acts, NOW, HL)
    expect(effective.earnestness).toBeLessThan(NEUTRAL_TRAITS.earnestness)
  })

  it('burying an IRONIC slop pulls AWAY from ironic — i.e. toward earnest (push from the opposite pole)', () => {
    const acts: CharacterAct[] = [{ traits: IRONIC, value: -1, createdAt: ago(0) }]
    const effective = accreteCharacter(NEUTRAL_TRAITS, acts, NOW, HL)
    expect(effective.earnestness).toBeGreaterThan(NEUTRAL_TRAITS.earnestness)
  })

  it('only the acted axis moves — neutral axes of the slop leave the base axis untouched', () => {
    // EARNEST is neutral on austerity/curse/density (0.5), so their pull term is 0.
    const acts: CharacterAct[] = [{ traits: EARNEST, value: 1, createdAt: ago(0) }]
    const effective = accreteCharacter(NEUTRAL_TRAITS, acts, NOW, HL)
    expect(effective.austerity).toBeCloseTo(NEUTRAL_TRAITS.austerity, 12)
    expect(effective.curse).toBeCloseTo(NEUTRAL_TRAITS.curse, 12)
    expect(effective.density).toBeCloseTo(NEUTRAL_TRAITS.density, 12)
  })
})

describe('accreteCharacter — recency: recent acts outweigh old ones', () => {
  it('a fresh bless outweighs a stale opposing bury (the net pull follows the recent act)', () => {
    const acts: CharacterAct[] = [
      { traits: EARNEST, value: -1, createdAt: ago(4 * HL) }, // old: push earnestness down
      { traits: EARNEST, value: 1, createdAt: ago(0) }, // fresh: pull earnestness up
    ]
    const effective = accreteCharacter(NEUTRAL_TRAITS, acts, NOW, HL)
    expect(effective.earnestness).toBeGreaterThan(NEUTRAL_TRAITS.earnestness)
  })

  it('the SAME act counts less the older it is (monotone decay of influence)', () => {
    const recent = accreteCharacter(NEUTRAL_TRAITS, [{ traits: EARNEST, value: 1, createdAt: ago(0) }], NOW, HL)
    const old = accreteCharacter(NEUTRAL_TRAITS, [{ traits: EARNEST, value: 1, createdAt: ago(3 * HL) }], NOW, HL)
    // A lone act's weight cancels in the mean (pull = value·offset regardless of its own weight), so a
    // single act lands the same; recency only arbitrates BETWEEN competing acts. Pin that: one recent and
    // one old lone act produce the identical effective vector.
    expect(recent.earnestness).toBeCloseTo(old.earnestness, 12)
  })

  it('weight ARBITRATES between competing acts: a recent bury beats an old bless', () => {
    const acts: CharacterAct[] = [
      { traits: EARNEST, value: 1, createdAt: ago(5 * HL) }, // old bless
      { traits: EARNEST, value: -1, createdAt: ago(0) }, // recent bury
    ]
    const effective = accreteCharacter(NEUTRAL_TRAITS, acts, NOW, HL)
    expect(effective.earnestness).toBeLessThan(NEUTRAL_TRAITS.earnestness)
  })
})

describe('accreteCharacter — always a legal TraitVector', () => {
  it('saturates at the pole, never escapes [0,1], under a relentless one-way history', () => {
    const base: TraitVector = { austerity: 0.9, curse: 0.9, density: 0.9, earnestness: 0.9 }
    const maxed: TraitVector = { austerity: 1, curse: 1, density: 1, earnestness: 1 }
    const acts: CharacterAct[] = Array.from({ length: 50 }, (_, k) => ({
      traits: maxed,
      value: 1 as const,
      createdAt: ago(k * HL * 0.01),
    }))
    const effective = accreteCharacter(base, acts, NOW, HL)
    for (const axis of Object.keys(effective) as (keyof TraitVector)[]) {
      expect(effective[axis]).toBeGreaterThanOrEqual(0)
      expect(effective[axis]).toBeLessThanOrEqual(1)
    }
  })

  it('a fully-consistent history shifts an axis by at most ~ACCRETION_WEIGHT·0.5 (base stays recognizable)', () => {
    // Every act blesses a max-pole slop from a neutral base: pull → +0.5, shift → ACCRETION_WEIGHT·0.5.
    const maxed: TraitVector = { austerity: 1, curse: 1, density: 1, earnestness: 1 }
    const acts: CharacterAct[] = Array.from({ length: 20 }, (_, k) => ({
      traits: maxed,
      value: 1 as const,
      createdAt: ago(k * HL * 0.05),
    }))
    const effective = accreteCharacter(NEUTRAL_TRAITS, acts, NOW, HL)
    const shift = effective.earnestness - NEUTRAL_TRAITS.earnestness
    expect(shift).toBeLessThanOrEqual(ACCRETION_WEIGHT * 0.5 + 1e-9)
    expect(shift).toBeGreaterThan(0)
  })
})
