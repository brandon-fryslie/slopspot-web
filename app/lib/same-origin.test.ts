import { describe, expect, it } from 'vitest'
import { isSameOrigin } from './same-origin'

function makeRequest(opts: { url?: string; origin?: string | null } = {}): Request {
  const headers = new Headers()
  if (opts.origin !== undefined && opts.origin !== null) {
    headers.set('Origin', opts.origin)
  }
  if (opts.origin === null) {
    headers.set('Origin', 'null')
  }
  return new Request(opts.url ?? 'https://slopspot.ai/api/x', { method: 'POST', headers })
}

describe('isSameOrigin', () => {
  it('returns true when Origin header is absent', () => {
    // Legitimate same-origin tooling / older clients can omit Origin; treat
    // absence as same-origin and lean on SameSite=Lax as the secondary defense.
    expect(isSameOrigin(makeRequest())).toBe(true)
  })

  it('returns true when Origin matches request URL origin', () => {
    expect(
      isSameOrigin(makeRequest({ url: 'https://slopspot.ai/api/x', origin: 'https://slopspot.ai' })),
    ).toBe(true)
  })

  it('returns false when Origin host differs', () => {
    expect(
      isSameOrigin(
        makeRequest({ url: 'https://slopspot.ai/api/x', origin: 'https://attacker.example' }),
      ),
    ).toBe(false)
  })

  it('returns false when Origin scheme differs (http vs https)', () => {
    // Scheme is part of the RFC 6454 tuple — comparing .host would let an
    // http:// page drive POSTs against the https:// production deploy.
    expect(
      isSameOrigin(
        makeRequest({ url: 'https://slopspot.ai/api/x', origin: 'http://slopspot.ai' }),
      ),
    ).toBe(false)
  })

  it('returns false on literal "null" origin (sandboxed iframe / opaque)', () => {
    // `new URL("null")` throws; the catch fails closed.
    expect(
      isSameOrigin(makeRequest({ url: 'https://slopspot.ai/api/x', origin: null })),
    ).toBe(false)
  })

  it('returns false on a structurally unparseable Origin', () => {
    expect(
      isSameOrigin(
        makeRequest({ url: 'https://slopspot.ai/api/x', origin: 'not a url at all' }),
      ),
    ).toBe(false)
  })

  it('treats vite dev http://localhost as same-origin when request URL matches', () => {
    expect(
      isSameOrigin(
        makeRequest({ url: 'http://localhost:5173/api/x', origin: 'http://localhost:5173' }),
      ),
    ).toBe(true)
  })

  it('returns false when ports differ on the same scheme/host', () => {
    expect(
      isSameOrigin(
        makeRequest({ url: 'http://localhost:5173/api/x', origin: 'http://localhost:5174' }),
      ),
    ).toBe(false)
  })
})
