// Route canonicalization for the CPU tail consumer.
//
// [LAW:one-source-of-truth] The set of route PATTERNS is derived from the same
// `app/routes.ts` table the application serves. `flattenRoutePatterns` walks the
// RR7 RouteConfigEntry tree (the exact shape `app/routes.ts` exports) and yields
// every concrete URL pattern. The generated constant `ROUTE_PATTERNS` is produced
// from this function (scripts/gen-route-patterns.ts) and a drift test asserts the
// constant equals a live re-derivation from `app/routes.ts` — so the two cannot
// diverge. A hand-maintained parallel list would drift; this cannot.
//
// [LAW:dataflow-not-control-flow] Canonicalization is a single match over a data
// table (the patterns), not a tower of per-route ifs. The same match runs for
// every pathname; variability lives in the pattern list, not in branches.

// The structural shape of an `app/routes.ts` entry. Mirrors RR7's RouteConfigEntry
// (path?, index?, children?) — the only fields canonicalization needs. Typed here
// rather than imported from @react-router/dev so this module (and the tail worker
// that uses it) carry no build-time dependency.
export type RoutePatternEntry = {
  path?: string
  index?: boolean
  children?: RoutePatternEntry[]
}

// The bucket every unmatched pathname collapses to, so cardinality stays bounded
// even for paths no route serves (probes, 404s, static misses).
export const OTHER_ROUTE = 'other' as const

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '')

// Join a parent pattern with a child segment the way RR7 composes nested routes:
// a layout/pathless parent contributes nothing of its own; the child's path (which
// in this table is already the full path under a pathless layout) concatenates.
const joinPattern = (parent: string, segment: string): string => {
  const clean = trimSlashes(segment)
  if (parent === '/') return clean === '' ? '/' : `/${clean}`
  return clean === '' ? parent : `${parent}/${clean}`
}

// [LAW:one-source-of-truth] Derive the flat pattern list from the route tree.
// `index()` routes (no path) under the root map to '/'; pathless layouts pass their
// accumulated parent through to children; every entry with a path yields one pattern.
export function flattenRoutePatterns(
  entries: readonly RoutePatternEntry[],
  parent = '/',
): string[] {
  return entries.flatMap((entry) => {
    const self = entry.path === undefined ? parent : joinPattern(parent, entry.path)
    const here =
      entry.path === undefined
        ? entry.index
          ? [parent]
          : []
        : [self]
    const fromChildren = entry.children ? flattenRoutePatterns(entry.children, self) : []
    return [...here, ...fromChildren]
  })
}

// A pattern matcher compiled from a route pattern. `:param` segments match any single
// non-empty segment; literal segments match exactly. This is what collapses concrete
// IDs (/p/abc-123 -> /p/:id) so the metric's `route` label is bounded-cardinality.
type Matcher = { pattern: string; segments: { literal: string | null }[] }

const compile = (pattern: string): Matcher => ({
  pattern,
  segments: trimSlashes(pattern)
    .split('/')
    .filter((s) => s !== '')
    .map((s) => ({ literal: s.startsWith(':') ? null : s })),
})

const segmentsOf = (pathname: string): string[] =>
  trimSlashes(pathname)
    .split('/')
    .filter((s) => s !== '')

const matches = (m: Matcher, pathSegments: string[]): boolean =>
  m.segments.length === pathSegments.length &&
  m.segments.every((seg, i) => seg.literal === null || seg.literal === pathSegments[i])

// [LAW:dataflow-not-control-flow] One match over the pattern table for every pathname.
// Returns the matched RR7 pattern (the metric label) or the single `other` bucket.
// Root '/' is the zero-segment pathname matching the zero-segment '/' pattern.
export function canonicalizeRoute(
  pathname: string,
  patterns: readonly string[],
): string {
  const pathSegments = segmentsOf(pathname)
  const hit = patterns.map(compile).find((m) => matches(m, pathSegments))
  return hit ? hit.pattern : OTHER_ROUTE
}
