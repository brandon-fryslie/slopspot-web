import type { Route } from "./+types/media.$key"

// [LAW:single-enforcer] The only path from R2 to the public. ingestImage stores
// bytes under a sha256 key; this route serves them back. Aggressive cache
// headers are safe because the key IS the content address — bytes for a given
// key never change, so a fresh response is indistinguishable from a cached one.

export async function loader({ params, context }: Route.LoaderArgs) {
  const obj = await context.cloudflare.env.MEDIA.get(params.key)
  if (obj === null) {
    // [LAW:no-defensive-null-guards] exception: R2.get returns null for unknown
    // keys; the route's job IS to map "no such object" to a 404 at the HTTP
    // trust boundary. Not a defensive guard — the legitimate not-found path.
    return new Response("not found", { status: 404 })
  }
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set("etag", obj.httpEtag)
  headers.set("cache-control", "public, max-age=31536000, immutable")
  return new Response(obj.body, { headers })
}
