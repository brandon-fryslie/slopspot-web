import { describe, it, expect } from 'vitest'
import { parseFalFluxResponse } from './fal-flux'

// [LAW:no-defensive-null-guards] These tests pin the trust-boundary contract:
// the parser MUST reject the wrong shape loudly (so a fal.ai API change
// surfaces as a structured 502 at the route, not as silent garbage flowing
// into D1). A passing parse MUST land all dimensions byte-for-byte.

describe('parseFalFluxResponse', () => {
  it('parses a realistic fal.ai schnell response into Media', () => {
    const fixture = {
      images: [
        {
          url: 'https://fal.media/files/abc/image.png',
          width: 1024,
          height: 1024,
          content_type: 'image/png',
        },
      ],
      seed: 42,
    }
    expect(parseFalFluxResponse(fixture, 'a robot painting')).toEqual({
      kind: 'image',
      url: 'https://fal.media/files/abc/image.png',
      w: 1024,
      h: 1024,
      alt: 'a robot painting',
    })
  })

  it('uses the FIRST image when fal returns multiple', () => {
    const fixture = {
      images: [
        { url: 'https://fal.media/files/a/1.png', width: 1024, height: 1024 },
        { url: 'https://fal.media/files/a/2.png', width: 1024, height: 1024 },
      ],
    }
    const result = parseFalFluxResponse(fixture, 'p')
    expect(result.kind === 'image' && result.url).toBe('https://fal.media/files/a/1.png')
  })

  it('throws when the images array is missing', () => {
    expect(() => parseFalFluxResponse({ seed: 1 }, 'p')).toThrow()
  })

  it('throws when the images array is empty', () => {
    expect(() => parseFalFluxResponse({ images: [] }, 'p')).toThrow()
  })

  it('throws when width is not a positive integer', () => {
    const bad = { images: [{ url: 'https://x/y.png', width: 0, height: 1024 }] }
    expect(() => parseFalFluxResponse(bad, 'p')).toThrow()
  })

  it('throws when url is not a URL', () => {
    const bad = { images: [{ url: 'not-a-url', width: 1024, height: 1024 }] }
    expect(() => parseFalFluxResponse(bad, 'p')).toThrow()
  })
})
