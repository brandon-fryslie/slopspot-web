import { describe, expect, it } from 'vitest'
import { readVoterId, resolveVoter } from './voter-cookie'

function makeRequest(opts: { url?: string; cookie?: string } = {}): Request {
  const headers = new Headers()
  if (opts.cookie !== undefined) headers.set('Cookie', opts.cookie)
  return new Request(opts.url ?? 'https://slopspot.ai/', { headers })
}

describe('readVoterId', () => {
  it('returns undefined when no Cookie header is present', () => {
    expect(readVoterId(makeRequest())).toBeUndefined()
  })

  it('returns undefined when Cookie header has unrelated cookies', () => {
    expect(readVoterId(makeRequest({ cookie: 'foo=bar; baz=qux' }))).toBeUndefined()
  })

  it('reads the slopspot_voter cookie value', () => {
    expect(readVoterId(makeRequest({ cookie: 'slopspot_voter=abc-123' }))).toBe('abc-123')
  })

  it('reads slopspot_voter from among other cookies', () => {
    expect(
      readVoterId(makeRequest({ cookie: 'foo=bar; slopspot_voter=xyz; baz=qux' })),
    ).toBe('xyz')
  })
})

describe('resolveVoter', () => {
  it('mints a fresh id and Set-Cookie when no cookie exists', () => {
    const result = resolveVoter(makeRequest())
    expect(result.voterId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(result.setCookieHeader).not.toBeNull()
    expect(result.setCookieHeader).toContain(`slopspot_voter=${result.voterId}`)
    expect(result.setCookieHeader).toContain('HttpOnly')
    expect(result.setCookieHeader).toContain('SameSite=Lax')
    expect(result.setCookieHeader).toContain('Path=/')
  })

  it('marks the cookie Secure when the request is over HTTPS', () => {
    const result = resolveVoter(makeRequest({ url: 'https://slopspot.ai/' }))
    expect(result.setCookieHeader).toContain('Secure')
  })

  it('omits Secure when the request is over HTTP (vite dev path)', () => {
    const result = resolveVoter(makeRequest({ url: 'http://localhost:5173/' }))
    expect(result.setCookieHeader).not.toContain('Secure')
  })

  it('reuses the existing voter id and emits no Set-Cookie', () => {
    const result = resolveVoter(makeRequest({ cookie: 'slopspot_voter=existing-id' }))
    expect(result.voterId).toBe('existing-id')
    expect(result.setCookieHeader).toBeNull()
  })
})
