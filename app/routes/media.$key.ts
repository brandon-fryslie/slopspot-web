import type { Route } from "./+types/media.$key"

// [LAW:types-are-the-program] The Workers runtime exposes `caches.default` (the
// colo edge cache), but lib.dom's `CacheStorage` interface — pulled in by the
// app's `lib: ["DOM"]` for React SSR — shadows the generated Workers type and
// omits `default`. The runtime shape is the ground truth; this states it by
// merging with the DOM interface (interface+interface, so no value-name
// collision with the generated `declare class CacheStorage`). Not a cast: the
// global genuinely carries this member at runtime.
declare global {
  interface CacheStorage {
    readonly default: Cache
  }
}

// [LAW:single-enforcer] The only path from R2 to the public. ingestImage stores
// bytes under a sha256 key; this route serves them back. Aggressive cache
// headers are safe because the key IS the content address — bytes for a given
// key never change, so a fresh response is indistinguishable from a cached one.
//
// A Worker is middleware in FRONT of Cloudflare's edge cache, so a worker-routed
// path always invokes the worker — the immutable cache-control header alone does
// not stop repeat reads from billing CPU. caches.default is how this worker reads
// and writes the colo edge cache itself: a hit is served straight from cache and
// issues NO R2 subrequest, collapsing repeat-read CPU to the match() lookup.

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const cache = caches.default

  // [LAW:dataflow-not-control-flow] Hit/miss is a VALUE the colo cache returns
  // (Response | undefined), not a branch that decides whether to serve. Both
  // arms serve a Response; the optionality is folded by returning the cached
  // Response when present. cache.match issues no subrequest, so a hit never
  // touches R2 — the CPU win lives entirely in the value, not in skipped work.
  const cached = await cache.match(request)
  if (cached) return cached

  const obj = await context.cloudflare.env.MEDIA.get(params.key)
  if (obj === null) {
    // [LAW:no-defensive-null-guards] exception: R2.get returns null for unknown
    // keys; the route's job IS to map "no such object" to a 404 at the HTTP
    // trust boundary. Not a defensive guard — the legitimate not-found path.
    // Left uncached (no cache.put on this arm): a key absent now is not proof
    // it is absent forever, and negative caching would mask a later write.
    return new Response("not found", { status: 404 })
  }

  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set("etag", obj.httpEtag)
  headers.set("cache-control", "public, max-age=31536000, immutable")
  const response = new Response(obj.body, { headers })

  // Store an independent clone so the body streamed to the client and the body
  // held by the cache do not share a consumed stream. waitUntil lets the
  // response return without blocking on the put — the write outlives the request.
  context.cloudflare.ctx.waitUntil(cache.put(request, response.clone()))
  return response
}
