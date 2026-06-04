import { describe, expect, it } from 'vitest'
import routes from '~/routes'
import {
  OTHER_ROUTE,
  canonicalizeRoute,
  flattenRoutePatterns,
  type RoutePatternEntry,
} from '~/lib/route-canonicalize'
import { ROUTE_PATTERNS } from '~/lib/route-patterns.generated'

// RR7's RouteConfigEntry is structurally the RoutePatternEntry shape canonicalization
// reads (path?/index?/children?). The route table is the source of truth.
const routeTable = routes as unknown as RoutePatternEntry[]

describe('flattenRoutePatterns', () => {
  it('maps index() to /, leaves :params, and resolves nested layout children', () => {
    const patterns = flattenRoutePatterns([
      { index: true }, // home -> /
      { path: 'p/:id' },
      { children: [{ path: 'admin/personas' }] }, // pathless layout
    ])
    expect(patterns).toEqual(['/', '/p/:id', '/admin/personas'])
  })

  it('drops pathless non-index entries that have no children', () => {
    expect(flattenRoutePatterns([{}])).toEqual([])
  })
})

// [LAW:one-source-of-truth] The committed constant MUST equal a live re-derivation from
// app/routes.ts. This is the mechanical drift guard: if a route is added/removed/renamed
// without regenerating, this fails. A hand-maintained parallel list cannot offer this.
describe('ROUTE_PATTERNS drift guard', () => {
  it('matches a fresh derivation from app/routes.ts', () => {
    expect([...ROUTE_PATTERNS]).toEqual(flattenRoutePatterns(routeTable))
  })
})

describe('canonicalizeRoute', () => {
  const cases: Array<[string, string]> = [
    ['/', '/'],
    ['/health', '/health'],
    ['/api/feed', '/api/feed'],
    ['/api/challenge', '/api/challenge'],
    ['/api/generate', '/api/generate'],
    ['/api/posts/abc-123/vote', '/api/posts/:id/vote'],
    ['/api/posts/xyz/comments', '/api/posts/:id/comments'],
    ['/api/fork/post_42', '/api/fork/:id'],
    ['/api/breed/p9', '/api/breed/:id'],
    ['/api/rewrite-prompt', '/api/rewrite-prompt'],
    ['/api/found', '/api/found'],
    ['/api/cast/marble-faun/back', '/api/cast/:handle/back'],
    ['/api/well', '/api/well'],
    ['/well', '/well'],
    ['/fork/deadbeef', '/fork/:id'],
    ['/breed/cafef00d', '/breed/:id'],
    ['/p/abc-123', '/p/:id'],
    ['/submit', '/submit'],
    ['/media/9f86d081884c7d659a2feaa0c55ad015', '/media/:key'],
    ['/cast', '/cast'],
    ['/cast/the-curator', '/cast/:handle'],
    ['/about/agents', '/about/agents'],
    ['/admin/personas', '/admin/personas'],
  ]

  it.each(cases)('collapses %s -> %s', (pathname, expected) => {
    expect(canonicalizeRoute(pathname, ROUTE_PATTERNS)).toBe(expected)
  })

  it('every generated pattern round-trips (no two patterns collide on a sample path)', () => {
    for (const pattern of ROUTE_PATTERNS) {
      // Build a concrete path by substituting each :param with a sample segment.
      const sample = pattern
        .split('/')
        .map((seg) => (seg.startsWith(':') ? 'sample' : seg))
        .join('/')
      expect(canonicalizeRoute(sample, ROUTE_PATTERNS)).toBe(pattern)
    }
  })

  it('buckets unknown / mismatched paths to the other bucket', () => {
    expect(canonicalizeRoute('/nope/nowhere', ROUTE_PATTERNS)).toBe(OTHER_ROUTE)
    expect(canonicalizeRoute('/p', ROUTE_PATTERNS)).toBe(OTHER_ROUTE) // too few segments
    expect(canonicalizeRoute('/p/a/b', ROUTE_PATTERNS)).toBe(OTHER_ROUTE) // too many
    expect(canonicalizeRoute('/favicon.ico', ROUTE_PATTERNS)).toBe(OTHER_ROUTE)
  })

  it('treats trailing slashes as equivalent', () => {
    expect(canonicalizeRoute('/p/abc/', ROUTE_PATTERNS)).toBe('/p/:id')
    expect(canonicalizeRoute('/cast/', ROUTE_PATTERNS)).toBe('/cast')
  })
})
