import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { loader } from '~/routes/media.$key'

// The `ProvidedEnv` augmentation is declared once in
// app/db/__tests__/setup.ts (loaded via vitest setupFiles); module
// augmentations are global within a TypeScript compilation.

// Constructs a minimal LoaderArgs for the media.$key route.
// The loader only accesses params.key and context.cloudflare.env.MEDIA. The
// `url` and `pattern` fields are required by RR7's CreateServerLoaderArgs
// type even though the loader does not read them.
// ExecutionContext stub that captures waitUntil work so the test can await it.
// The loader writes to caches.default via ctx.waitUntil(cache.put(...)); a no-op
// waitUntil would drop that promise on the floor and the cache would stay empty,
// making the hit path untestable. Collecting and draining the promises exercises
// the real production write path instead of mocking it away.
const pending: Promise<unknown>[] = []
const stubCtx: ExecutionContext = {
  waitUntil(promise) {
    pending.push(Promise.resolve(promise))
  },
  passThroughOnException() {},
  exports: {} as Cloudflare.Exports,
  props: {},
}
const drainWaitUntil = () => Promise.all(pending.splice(0))

const argsForUrl = (key: string, url: URL): Parameters<typeof loader>[0] =>
  ({
    params: { key },
    context: { cloudflare: { env, ctx: stubCtx } },
    request: new Request(url),
    url,
    pattern: '/media/:key',
  }) as Parameters<typeof loader>[0]

const args = (key: string): Parameters<typeof loader>[0] =>
  argsForUrl(key, new URL(`https://slopspot.ai/media/${key}`))

const argsWithQuery = (key: string, query: string): Parameters<typeof loader>[0] =>
  argsForUrl(key, new URL(`https://slopspot.ai/media/${key}?${query}`))

describe('/media/:key route loader', () => {
  it('returns 404 for an unknown key', async () => {
    const response = await loader(args('nonexistent-sha256-key'))
    expect(response.status).toBe(404)
  })

  it('returns 200 with correct content-type, immutable cache header, and byte-identical body for a stored object', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const key = 'ab'.repeat(32)
    await env.MEDIA.put(key, bytes.buffer, { httpMetadata: { contentType: 'image/webp' } })

    const response = await loader(args(key))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')

    const body = new Uint8Array(await response.arrayBuffer())
    expect(body).toEqual(bytes)
  })

  it('serves a repeat read from the edge cache without a second R2 read', async () => {
    const bytes = new Uint8Array([9, 8, 7, 6, 5])
    const key = 'cd'.repeat(32)
    await env.MEDIA.put(key, bytes.buffer, { httpMetadata: { contentType: 'image/png' } })

    // First read: cache miss -> R2 -> response cloned into caches.default.
    const first = await loader(args(key))
    expect(first.status).toBe(200)
    await first.arrayBuffer() // drain the client copy so the clone can settle
    await drainWaitUntil() // let cache.put complete

    // Delete the R2 object. A second read that still returns the bytes proves
    // it was served from the edge cache, not from R2 — the CPU-saving path.
    await env.MEDIA.delete(key)

    const second = await loader(args(key))
    expect(second.status).toBe(200)
    expect(second.headers.get('content-type')).toBe('image/png')
    expect(second.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    const body = new Uint8Array(await second.arrayBuffer())
    expect(body).toEqual(bytes)
  })

  it('serves a query-busted read from the same normalized cache entry (no fresh R2 miss)', async () => {
    const bytes = new Uint8Array([4, 2])
    const key = 'ef'.repeat(32)
    await env.MEDIA.put(key, bytes.buffer, { httpMetadata: { contentType: 'image/png' } })

    // Populate the cache via the bare key.
    const first = await loader(args(key))
    expect(first.status).toBe(200)
    await first.arrayBuffer()
    await drainWaitUntil()

    // Delete R2, then read with a cache-busting query string. The cache key is
    // the content address, not the raw URL, so this resolves to the SAME entry
    // — a 200 from cache proves the query variant did not bypass it into a dead
    // R2 read.
    await env.MEDIA.delete(key)

    const busted = await loader(argsWithQuery(key, 'cachebust=whatever'))
    expect(busted.status).toBe(200)
    expect(busted.headers.get('content-type')).toBe('image/png')
    const body = new Uint8Array(await busted.arrayBuffer())
    expect(body).toEqual(bytes)
  })
})
