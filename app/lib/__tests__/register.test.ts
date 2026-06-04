// [LAW:behavior-not-structure] traitBias's contract: neutral steers nothing; a leaning axis emits
// its pole's register and not the opposite; commitment scales with distance; and earnestness is the
// LEVER — high DROPS the distancing devices, low KEEPS them, and the two diverge. This is the
// register projection's own contract; the binding earnestness SOUL-TEST runs separately on Haiku's
// composed OUTPUT (a steer that names devices is not a composition that drops them).

import { describe, expect, it } from 'vitest'
import { NEUTRAL_TRAITS } from '~/lib/traits'
import { traitBias } from '~/lib/register'
import type { TraitVector } from '~/lib/domain'

const at = (over: Partial<TraitVector>): TraitVector => ({ ...NEUTRAL_TRAITS, ...over })

describe('traitBias — neutral is a no-op', () => {
  it('the neutral vector steers nothing (the firehose embeds no register line)', () => {
    expect(traitBias(NEUTRAL_TRAITS)).toBe('')
  })

  it('a within-band lean still reads neutral (continuous dial, not a hair-trigger)', () => {
    expect(traitBias(at({ curse: 0.53 }))).toBe('')
  })
})

describe('traitBias — a leaning axis emits its pole and not the opposite', () => {
  it('high austerity reaches for baroque ornament, never the austere pole', () => {
    const s = traitBias(at({ austerity: 0.95 }))
    expect(s).toContain('baroque ornament')
    expect(s).not.toContain('austerity — spare')
  })

  it('low austerity reaches for the austere pole, never baroque', () => {
    const s = traitBias(at({ austerity: 0.05 }))
    expect(s).toContain('austerity — spare')
    expect(s).not.toContain('baroque ornament')
  })

  it('only the leaning axis appears; neutral axes contribute nothing', () => {
    const s = traitBias(at({ density: 0.95 }))
    expect(s).toContain('density — teeming')
    expect(s).not.toContain('cursed')
    expect(s).not.toContain('baroque')
    expect(s).not.toContain('sincerity')
  })
})

describe('traitBias — commitment scales with distance from neutral (continuous weight)', () => {
  it('a faint lean tilts; a strong lean pushes hard', () => {
    expect(traitBias(at({ curse: 0.62 }))).toContain('tilt toward')
    expect(traitBias(at({ curse: 0.99 }))).toContain('push hard toward')
  })
})

describe('traitBias — EARNESTNESS is the lever (drop-vs-add)', () => {
  it('high earnestness DROPS the distancing devices and renders devotionally', () => {
    const s = traitBias(at({ earnestness: 0.95 }))
    expect(s).toContain('DROP every distancing device')
    expect(s).toContain('devotionally')
    expect(s).toContain('do not look away')
  })

  it('low earnestness KEEPS the distancing devices and stays in on the joke', () => {
    const s = traitBias(at({ earnestness: 0.05 }))
    expect(s).toContain('KEEP the distancing devices')
    expect(s).toContain('scare-quotes')
    expect(s).toContain('in on its own joke')
  })

  it('the two poles DIVERGE — same genome, only earnestness flipped, opposite register', () => {
    const sincere = traitBias(at({ earnestness: 0.95 }))
    const ironic = traitBias(at({ earnestness: 0.05 }))
    expect(sincere).not.toBe(ironic)
    // sincerity drops devices; irony keeps them — the steers must not collapse to the same register.
    expect(sincere).toContain('DROP')
    expect(ironic).toContain('KEEP')
  })

  it('sincere is MASK-vs-FACE, not warm-vs-cool — never reaches for pleasant/wholesome', () => {
    const s = traitBias(at({ earnestness: 0.95 }))
    expect(s.toLowerCase()).not.toContain('pleasant')
    expect(s.toLowerCase()).not.toContain('wholesome')
    expect(s.toLowerCase()).not.toContain('cheerful')
  })
})

describe('traitBias — pure (one vector in, same steer out for both consumers)', () => {
  it('is deterministic: identical traits yield an identical steer', () => {
    const t = at({ austerity: 0.8, earnestness: 0.2 })
    expect(traitBias(t)).toBe(traitBias(t))
  })
})
