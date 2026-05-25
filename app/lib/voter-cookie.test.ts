import { describe, expect, it } from 'vitest'
import { readVoterId, resolveVoter } from './voter-cookie'

function makeRequest(opts: { url?: string; cookie?: string } = {}): Request {
  const headers = new Headers()
  if (opts.cookie !== undefined) headers.set('Cookie', opts.cookie)
  return new Request(opts.url ?? 'https://slopspot.ai/', { headers })
}

// Three arbitrary RFC-4122 UUIDs used as test fixtures. Any UUID-shaped string
// works; the validator does not care about version bits, only the hex/dash shape.
const UUID_A = '11111111-2222-3333-4444-555555555555'
const UUID_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

describe('readVoterId', () => {
  it('returns undefined when no Cookie header is present', () => {
    expect(readVoterId(makeRequest())).toBeUndefined()
  })

  it('returns undefined when Cookie header has unrelated cookies', () => {
    expect(readVoterId(makeRequest({ cookie: 'foo=bar; baz=qux' }))).toBeUndefined()
  })

  it('reads the slopspot_voter cookie value when it is a valid UUID', () => {
    expect(readVoterId(makeRequest({ cookie: `slopspot_voter=${UUID_A}` }))).toBe(UUID_A)
  })

  it('reads slopspot_voter from among other cookies', () => {
    expect(
      readVoterId(makeRequest({ cookie: `foo=bar; slopspot_voter=${UUID_B}; baz=qux` })),
    ).toBe(UUID_B)
  })

  it('rejects an empty slopspot_voter value as if no cookie were present', () => {
    // [LAW:single-enforcer] An attacker setting `slopspot_voter=` (empty) MUST
    // not propagate the empty-string sentinel into the feed reader's LEFT JOIN
    // or into a stored vote row. The boundary parser is where that's blocked.
    expect(readVoterId(makeRequest({ cookie: 'slopspot_voter=' }))).toBeUndefined()
  })

  it('rejects a non-UUID slopspot_voter value', () => {
    expect(readVoterId(makeRequest({ cookie: 'slopspot_voter=not-a-uuid' }))).toBeUndefined()
  })

  it('rejects an oversized slopspot_voter value', () => {
    // Forces the regex's anchored length check — 36 chars is the upper bound.
    expect(
      readVoterId(makeRequest({ cookie: `slopspot_voter=${UUID_A}-extra` })),
    ).toBeUndefined()
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

  it('reuses an existing valid voter id and emits no Set-Cookie', () => {
    const result = resolveVoter(makeRequest({ cookie: `slopspot_voter=${UUID_A}` }))
    expect(result.voterId).toBe(UUID_A)
    expect(result.setCookieHeader).toBeNull()
  })

  it('mints fresh when the existing cookie value is malformed', () => {
    // A forged or stale cookie value MUST NOT slip past the boundary. The
    // resolver treats it as if no cookie were sent: mint, and emit Set-Cookie
    // so the next request carries a clean id.
    const result = resolveVoter(makeRequest({ cookie: 'slopspot_voter=' }))
    expect(result.voterId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(result.voterId).not.toBe('')
    expect(result.setCookieHeader).not.toBeNull()
  })
})
