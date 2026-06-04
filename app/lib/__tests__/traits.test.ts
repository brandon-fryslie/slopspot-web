// [LAW:behavior-not-structure] Pins the traitVectorSchema boundary contract: it accepts
// EXACTLY the four locked axes, each in [0,1], and REJECTS everything else — the enforcement
// the paletteBias-cut and resolution-reserved locks rest on. A plain z.object() would silently
// strip an unknown key (accept-and-drop); these assertions prove .strict() rejects it loud, and
// that out-of-range values fail at the read boundary (the re-validate-at-D1 discipline).

import { describe, it, expect } from 'vitest'
import { NEUTRAL_TRAITS, traitVectorSchema } from '~/lib/traits'

describe('traitVectorSchema — the strongest true theorem about a TraitVector', () => {
  it('accepts the neutral vector (exactly the four axes)', () => {
    expect(traitVectorSchema.parse(NEUTRAL_TRAITS)).toEqual(NEUTRAL_TRAITS)
  })

  it('accepts in-range non-neutral values (what L2/L3 drift will write)', () => {
    const v = { austerity: 0, curse: 1, density: 0.25, earnestness: 0.9 }
    expect(traitVectorSchema.parse(v)).toEqual(v)
  })

  it('REJECTS a cut/reserved axis sneaking in — never accept-and-drop [LAW:no-silent-fallbacks]', () => {
    // paletteBias was cut (warmth derives); resolution is reserved (System III). A stale
    // migration or an L2 write bug must be rejected at this boundary, not silently stripped.
    expect(() => traitVectorSchema.parse({ ...NEUTRAL_TRAITS, paletteBias: 0.5 })).toThrow()
    expect(() => traitVectorSchema.parse({ ...NEUTRAL_TRAITS, resolution: 0.5 })).toThrow()
  })

  it('REJECTS out-of-range values — storage can lie even though L1 writes only 0.5', () => {
    expect(() => traitVectorSchema.parse({ ...NEUTRAL_TRAITS, curse: 5 })).toThrow()
    expect(() => traitVectorSchema.parse({ ...NEUTRAL_TRAITS, austerity: -1 })).toThrow()
  })

  it('REJECTS a missing axis or a non-number', () => {
    expect(() =>
      traitVectorSchema.parse({ austerity: 0.5, curse: 0.5, density: 0.5 }),
    ).toThrow() // earnestness missing
    expect(() => traitVectorSchema.parse({ ...NEUTRAL_TRAITS, density: 'dense' })).toThrow()
  })
})
