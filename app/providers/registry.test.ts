import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import '~/providers' // populate the registry with the real three
import { ProviderId } from '~/lib/domain'
import { getProvider, registerProvider, UnknownProviderError } from './registry'
import type { GenerationProvider } from './types'

// [LAW:single-enforcer] The registry is the one place provider lookup happens.
// These tests pin two invariants:
//   1. register-once: re-registering the same id throws (so a typo'd duplicate
//      in app/providers/index.ts breaks the build at load time, not at request
//      time with mysterious behavior).
//   2. unknown id → UnknownProviderError (a typed error, not a generic Error,
//      so callers map it to HTTP 404 by class, not by string-matching).

function makeStubProvider(id: string): GenerationProvider<{ prompt: string }> {
  return {
    id: ProviderId(id),
    version: 'v',
    displayName: id,
    paramsSchema: z.object({ prompt: z.string() }),
    capabilities: { producesMedia: ['image'], supportsSeed: false, costEstimateUsd: 0 },
    supportedAspectRatios: ['1:1'],
    promptMaxLength: 500,
    defaultParamsForRecipe({ prompt }) {
      return { prompt }
    },
    async generate(_input) {
      return { kind: 'image', url: 'u', w: 1, h: 1 }
    },
  }
}

describe('provider registry', () => {
  it('throws when registering a provider id that is already registered', () => {
    // fal-flux is registered by `~/providers` side effect above.
    expect(() => registerProvider(makeStubProvider('fal-flux'))).toThrow(
      /already registered/i,
    )
  })

  it('throws UnknownProviderError for an unknown id', () => {
    expect(() => getProvider(ProviderId('does-not-exist'))).toThrow(UnknownProviderError)
  })

  it('UnknownProviderError carries the missing providerId for callers to map', () => {
    try {
      getProvider(ProviderId('also-missing'))
      expect.fail('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownProviderError)
      expect((err as UnknownProviderError).providerId).toBe('also-missing')
    }
  })
})
