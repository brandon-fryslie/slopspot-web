// [LAW:types-are-the-program] Route names are a closed set derived from app/routes.ts.
// The normalizer is the single place that maps live URL paths to stable metric labels —
// static IDs (post IDs, handles, media keys) are stripped, leaving the route shape.
// Unknown paths map to 'unknown' rather than leaking raw URLs into metric cardinality.

const PATTERNS: Array<[RegExp, string]> = [
  [/^\/api\/posts\/[^/]+\/vote$/, 'api.posts.$id.vote'],
  [/^\/api\/posts\/[^/]+\/comments$/, 'api.posts.$id.comments'],
  [/^\/api\/fork\/[^/]+$/, 'api.fork.$id'],
  [/^\/api\/breed\/[^/]+$/, 'api.breed.$id'],
  [/^\/api\/cast\/[^/]+\/back$/, 'api.cast.$handle.back'],
  [/^\/api\/feed(\?.*)?$/, 'api.feed'],
  [/^\/api\/challenge$/, 'api.challenge'],
  [/^\/api\/generate$/, 'api.generate'],
  [/^\/api\/rewrite-prompt$/, 'api.rewrite-prompt'],
  [/^\/api\/found$/, 'api.found'],
  [/^\/api\/well$/, 'api.well'],
  [/^\/p\/[^/]+$/, 'p.$id'],
  [/^\/fork\/[^/]+$/, 'fork.$id'],
  [/^\/breed\/[^/]+$/, 'breed.$id'],
  [/^\/cast\/[^/]+$/, 'cast.$handle'],
  [/^\/media\/[^/]+$/, 'media.$key'],
  [/^\/health$/, 'health'],
  [/^\/metrics$/, 'metrics'],
  [/^\/well$/, 'well'],
  [/^\/submit$/, 'submit'],
  [/^\/about\/agents$/, 'about.agents'],
  [/^\/admin\/personas$/, 'admin.personas'],
  [/^\/cast$/, 'cast._index'],
  [/^\/$/, 'home'],
]

// [LAW:one-source-of-truth] This is the single map from URL space to metric label space.
// Adding a route = one entry here + one entry in app/routes.ts.
export function normalizeRoute(pathname: string): string {
  for (const [pattern, label] of PATTERNS) {
    if (pattern.test(pathname)) return label
  }
  return 'unknown'
}
