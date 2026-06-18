import { describe, it, expect } from 'vitest'
import '~/providers' // populate the registry with every provider (side-effect import)
import { listProviders } from './registry'
import { STYLE_FAMILIES } from '~/lib/variety'

// [LAW:behavior-not-structure] The honest invariant behind capabilities.supportsNegativePrompt:
// a provider DECLARES it can take a native negative iff its defaultParamsForRecipe
// actually STEERS an embalmed-relic draw. We assert the declaration matches the behavior
// for EVERY registered provider — so "declared true but never emits" and "declared false
// but secretly steers" are both caught, and the prose [LAW:no-silent-failure] flag is
// replaced by a checked theorem rather than a comment a reviewer must trust.
//
// This single assertion does double duty:
//   1. supportsNegativePrompt === true  ⟹ params DIFFER between embalmed and ordinary draws
//      (the steering is real, not a forgotten branch).
//   2. supportsNegativePrompt === false ⟹ params are BYTE-FOR-BYTE identical regardless of
//      embalmedRelic — this IS the ticket's false-case regression guard: firehose/breed/fork
//      draws on a non-supporting provider are provably unaffected by the embalm flag.
//
// [LAW:dataflow-not-control-flow] The comparison is style-independent: we sweep every
// StyleFamily so a provider whose steering accidentally depended on style (it must not)
// would fail. The recipe's per-style variation cancels because it is identical on both
// sides of the embalmed/ordinary comparison.

// Same code path on both calls → identical key order, so the only way the serialization
// can differ is a value the provider varied by embalmedRelic. JSON.stringify drops
// undefined-valued keys, which is exactly the "no negative" shape (e.g. SDXL's
// negativePrompt: undefined on an ordinary draw), so a steering provider serializes
// strictly longer and a non-steering one serializes identically.
function paramsDifferByEmbalm(
  provider: ReturnType<typeof listProviders>[number],
  styleFamily: (typeof STYLE_FAMILIES)[number],
): boolean {
  const base = { prompt: 'a wished relic', styleFamily, seed: 12345 }
  const embalmed = provider.defaultParamsForRecipe({ ...base, embalmedRelic: true })
  const ordinary = provider.defaultParamsForRecipe({ ...base, embalmedRelic: false })
  return JSON.stringify(embalmed) !== JSON.stringify(ordinary)
}

describe('embalm negative-prompt capability is honest', () => {
  const providers = listProviders()

  it('registers at least one provider (the side-effect import populated the registry)', () => {
    expect(providers.length).toBeGreaterThan(0)
  })

  for (const provider of providers) {
    it(`${provider.id}: supportsNegativePrompt matches embalm-steering behavior across every style`, () => {
      for (const styleFamily of STYLE_FAMILIES) {
        expect(paramsDifferByEmbalm(provider, styleFamily)).toBe(
          provider.capabilities.supportsNegativePrompt,
        )
      }
    })
  }
})
