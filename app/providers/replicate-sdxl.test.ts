import { describe, it, expect } from 'vitest'
import { parseReplicateSdxlResponse, SDXL_DIMS } from './replicate-sdxl'

// [LAW:no-defensive-null-guards] These tests pin the trust-boundary contract:
// the parser MUST reject any Replicate prediction that isn't a succeeded one
// with a usable output URL array (so a Replicate API shape change or a model
// failure surfaces as a structured error at /api/generate, not as silent
// garbage flowing into D1). A passing parse MUST land the URL byte-for-byte
// and the dimensions from opts (Replicate doesn't echo dims in the response).

const succeeded = {
  id: 'pred_abc',
  status: 'succeeded',
  output: ['https://replicate.delivery/pbxt/abc/out-0.png'],
  error: null,
  urls: { get: 'https://api.replicate.com/v1/predictions/pred_abc' },
}

describe('parseReplicateSdxlResponse', () => {
  it('parses a succeeded SDXL prediction into Media', () => {
    expect(
      parseReplicateSdxlResponse(succeeded, { alt: 'a robot painting', w: 1024, h: 1024 }),
    ).toEqual({
      kind: 'image',
      url: 'https://replicate.delivery/pbxt/abc/out-0.png',
      w: 1024,
      h: 1024,
      alt: 'a robot painting',
    })
  })

  it('uses the FIRST url when output has multiple', () => {
    const fixture = {
      ...succeeded,
      output: [
        'https://replicate.delivery/pbxt/abc/out-0.png',
        'https://replicate.delivery/pbxt/abc/out-1.png',
      ],
    }
    const result = parseReplicateSdxlResponse(fixture, { alt: 'p', w: 1024, h: 1024 })
    expect(result.kind === 'image' && result.url).toBe('https://replicate.delivery/pbxt/abc/out-0.png')
  })

  it('throws when status is failed (with error text in the message)', () => {
    const fixture = { ...succeeded, status: 'failed', output: null, error: 'CUDA OOM' }
    expect(() => parseReplicateSdxlResponse(fixture, { alt: 'p', w: 1024, h: 1024 })).toThrow(/failed/)
  })

  it('throws when status is still processing (terminal-only parser)', () => {
    const fixture = { ...succeeded, status: 'processing', output: null }
    expect(() => parseReplicateSdxlResponse(fixture, { alt: 'p', w: 1024, h: 1024 })).toThrow(/processing/)
  })

  it('throws when status is canceled', () => {
    const fixture = { ...succeeded, status: 'canceled', output: null }
    expect(() => parseReplicateSdxlResponse(fixture, { alt: 'p', w: 1024, h: 1024 })).toThrow(/canceled/)
  })

  it('throws when status is an unknown value', () => {
    const fixture = { ...succeeded, status: 'rolling-back' }
    expect(() => parseReplicateSdxlResponse(fixture, { alt: 'p', w: 1024, h: 1024 })).toThrow()
  })

  it('throws when output is null on a succeeded prediction', () => {
    const fixture = { ...succeeded, output: null }
    expect(() => parseReplicateSdxlResponse(fixture, { alt: 'p', w: 1024, h: 1024 })).toThrow()
  })

  it('throws when output is an empty array', () => {
    const fixture = { ...succeeded, output: [] }
    expect(() => parseReplicateSdxlResponse(fixture, { alt: 'p', w: 1024, h: 1024 })).toThrow()
  })

  it('throws when output contains a non-URL string', () => {
    const fixture = { ...succeeded, output: ['not-a-url'] }
    expect(() => parseReplicateSdxlResponse(fixture, { alt: 'p', w: 1024, h: 1024 })).toThrow()
  })

  it('throws when id is missing (envelope corrupted)', () => {
    const fixture = { ...succeeded } as Record<string, unknown>
    delete fixture.id
    expect(() => parseReplicateSdxlResponse(fixture, { alt: 'p', w: 1024, h: 1024 })).toThrow()
  })
})

describe('SDXL_DIMS', () => {
  // The dims table is canonical for the SDXL family; both the real provider
  // and the mock consult it. This pins the variety design doc's §Aspect ratio
  // policy values so an accidental edit to one ratio doesn't silently change
  // generation geometry.
  it('matches the variety design doc values for every canonical ratio', () => {
    expect(SDXL_DIMS).toEqual({
      '1:1': { w: 1024, h: 1024 },
      '16:9': { w: 1344, h: 768 },
      '9:16': { w: 768, h: 1344 },
      '4:3': { w: 1152, h: 896 },
      '3:4': { w: 896, h: 1152 },
    })
  })
})
