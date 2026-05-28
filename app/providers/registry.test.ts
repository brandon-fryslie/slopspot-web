import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import '~/providers' // populate the registry with the real three
import { ProviderId } from '~/lib/domain'
import { getProvider, realProviders, registerProvider, UnknownProviderError } from './registry'
import type { GenerationProvider } from './types'

// [LAW:single-enforcer] The registry is the one place provider lookup happens.
// These tests pin two invariants:
//   1. register-once: re-registering the same id throws (so a typo'd duplicate
//      in app/providers/index.ts breaks the build at load time, not at request
//      time with mysterious behavior).
//   2. unknown id → UnknownProviderError (a typed error, not a generic Error,
//      so callers map it to HTTP 404 by class, not by string-matching).

function makeStubProvider(
  id: string,
  kind: 'real' | 'mock' = 'real',
): GenerationProvider<{ prompt: string }> {
  return {
    id: ProviderId(id),
    kind,
    version: 'v',
    displayName: id,
    paramsSchema: z.object({ prompt: z.string().min(1).max(500) }),
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

  // [LAW:single-enforcer] realProviders is the gate the firehose chooser uses
  // to avoid picking mock providers in prod. The discriminator is env.SLOPSPOT_ENV
  // — 'prod' filters; anything else is treated as dev (no filter).
  describe('realProviders env-scoped filter', () => {
    it("excludes kind: 'mock' providers when SLOPSPOT_ENV === 'prod'", () => {
      // [LAW:dataflow-not-control-flow] The env value is the discriminator;
      // no caller branches on "are we in prod" — they all just call this.
      const env = { SLOPSPOT_ENV: 'prod' } as unknown as Env
      const ids = realProviders(env).map((p) => String(p.id)).sort()
      // Real providers from the global registration in ~/providers.
      expect(ids).toEqual([
        'fal-flux',
        'replicate-ideogram',
        'replicate-sdxl',
      ])
    })

    it("includes mocks when SLOPSPOT_ENV !== 'prod' (dev mode)", () => {
      const env = { SLOPSPOT_ENV: 'dev' } as unknown as Env
      const ids = realProviders(env).map((p) => String(p.id))
      // All 6 providers (3 real + 3 mock) are eligible in dev.
      expect(ids).toContain('fal-flux-mock')
      expect(ids).toContain('replicate-sdxl-mock')
      expect(ids).toContain('replicate-ideogram-mock')
      expect(ids).toContain('fal-flux')
      expect(ids).toContain('replicate-sdxl')
      expect(ids).toContain('replicate-ideogram')
    })

    it('treats absent SLOPSPOT_ENV as dev (mocks included)', () => {
      // [LAW:types-are-the-program] Anything that is not the string 'prod'
      // routes to the dev arm — including undefined. This makes the prod
      // path opt-in via explicit configuration rather than opt-out by accident.
      const env = {} as unknown as Env
      const ids = realProviders(env).map((p) => String(p.id))
      expect(ids).toContain('fal-flux-mock')
    })
  })
})
