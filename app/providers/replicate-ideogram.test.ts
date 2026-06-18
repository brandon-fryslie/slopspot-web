import { describe, it, expect } from 'vitest'
import {
  parseReplicateIdeogramResponse,
  replicateIdeogram,
  IDEOGRAM_DIMS,
  IDEOGRAM_EMBALM_NEGATIVE,
} from './replicate-ideogram'

// [LAW:no-defensive-null-guards] These tests pin the trust-boundary contract:
// ideogram's `output` is a SINGLE URL string (not an array, unlike SDXL). The
// parser MUST accept that exact shape and reject the others — passing an
// array here would be a contract violation, not a "use first element"
// accident. The status-not-succeeded family mirrors the SDXL test set so the
// failure shape stays uniform across Replicate providers.

const succeeded = {
  id: 'pred_xyz',
  status: 'succeeded',
  output: 'https://replicate.delivery/pbxt/xyz/out.png',
  error: null,
  urls: { get: 'https://api.replicate.com/v1/predictions/pred_xyz' },
}

describe('parseReplicateIdeogramResponse', () => {
  it('parses a succeeded ideogram prediction into Media', () => {
    expect(
      parseReplicateIdeogramResponse(succeeded, { alt: 'a sign that reads HELLO', w: 1024, h: 1024 }),
    ).toEqual({
      kind: 'image',
      url: 'https://replicate.delivery/pbxt/xyz/out.png',
      w: 1024,
      h: 1024,
      alt: 'a sign that reads HELLO',
    })
  })

  it('rejects array output (SDXL shape, not ideogram shape)', () => {
    const fixture = { ...succeeded, output: ['https://replicate.delivery/pbxt/xyz/out.png'] }
    expect(() => parseReplicateIdeogramResponse(fixture, { alt: 'p', w: 1024, h: 1024 })).toThrow()
  })

  it('throws when status is failed (with error text in the message)', () => {
    const fixture = { ...succeeded, status: 'failed', output: null, error: 'NSFW filter triggered' }
    expect(() => parseReplicateIdeogramResponse(fixture, { alt: 'p', w: 1024, h: 1024 })).toThrow(/failed/)
  })

  it('throws when status is still processing (terminal-only parser)', () => {
    const fixture = { ...succeeded, status: 'processing', output: null }
    expect(() => parseReplicateIdeogramResponse(fixture, { alt: 'p', w: 1024, h: 1024 })).toThrow(/processing/)
  })

  it('throws when status is canceled', () => {
    const fixture = { ...succeeded, status: 'canceled', output: null }
    expect(() => parseReplicateIdeogramResponse(fixture, { alt: 'p', w: 1024, h: 1024 })).toThrow(/canceled/)
  })

  it('throws when status is an unknown value', () => {
    const fixture = { ...succeeded, status: 'rolling-back' }
    expect(() => parseReplicateIdeogramResponse(fixture, { alt: 'p', w: 1024, h: 1024 })).toThrow()
  })

  it('throws when output is null on a succeeded prediction', () => {
    const fixture = { ...succeeded, output: null }
    expect(() => parseReplicateIdeogramResponse(fixture, { alt: 'p', w: 1024, h: 1024 })).toThrow()
  })

  it('throws when output is a non-URL string', () => {
    const fixture = { ...succeeded, output: 'not-a-url' }
    expect(() => parseReplicateIdeogramResponse(fixture, { alt: 'p', w: 1024, h: 1024 })).toThrow()
  })

  it('throws when id is missing (envelope corrupted)', () => {
    const fixture = { ...succeeded } as Record<string, unknown>
    delete fixture.id
    expect(() => parseReplicateIdeogramResponse(fixture, { alt: 'p', w: 1024, h: 1024 })).toThrow()
  })
})

describe('replicateIdeogram.defaultParamsForRecipe — embalmedRelic negative steering', () => {
  // [LAW:behavior-not-structure] Same contract as SDXL: an embalmed-relic draw (the
  // wish occasion) gets the embalm-negative steering; an ordinary draw does NOT, so
  // the firehose's living-creature output is never steered away from living creatures
  // (slopspot-render-fidelity-v2l). The false case is the regression guard.
  const base = { prompt: 'a relic', styleFamily: 'photoreal', seed: 7 } as const

  it('applies the embalm negative when embalmedRelic is true', () => {
    const params = replicateIdeogram.defaultParamsForRecipe({ ...base, embalmedRelic: true })
    expect(params.negativePrompt).toBe(IDEOGRAM_EMBALM_NEGATIVE)
    expect(IDEOGRAM_EMBALM_NEGATIVE.length).toBeGreaterThan(0)
    expect(() => replicateIdeogram.paramsSchema.parse(params)).not.toThrow()
  })

  it('omits the negative (undefined) when embalmedRelic is false — no firehose regression', () => {
    const params = replicateIdeogram.defaultParamsForRecipe({ ...base, embalmedRelic: false })
    expect(params.negativePrompt).toBeUndefined()
    expect(() => replicateIdeogram.paramsSchema.parse(params)).not.toThrow()
  })
})

describe('IDEOGRAM_DIMS', () => {
  // Ideogram re-exports the shared REPLICATE_CANONICAL_DIMS table from
  // replicate-helpers. This test pins both the canonical values (so an
  // accidental edit to the shared table is caught here AND in the SDXL test)
  // and the contract that ideogram delivers the same nominal dims as SDXL
  // for every canonical ratio — [LAW:one-source-of-truth] no per-provider
  // drift on "what does ratio X mean in pixels".
  it('matches the canonical nominal dimensions for every canonical ratio', () => {
    expect(IDEOGRAM_DIMS).toEqual({
      '1:1': { w: 1024, h: 1024 },
      '16:9': { w: 1344, h: 768 },
      '9:16': { w: 768, h: 1344 },
      '4:3': { w: 1152, h: 896 },
      '3:4': { w: 896, h: 1152 },
    })
  })
})
