import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { loader } from '~/routes/media.$key'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}

// Constructs a minimal LoaderArgs for the media.$key route.
// The loader only accesses params.key and context.cloudflare.env.MEDIA. The
// `url` and `pattern` fields are required by RR7's CreateServerLoaderArgs
// type even though the loader does not read them.
// No-op ExecutionContext stub. The loader does not call ctx.waitUntil or
// ctx.passThroughOnException, but providing real methods (instead of an empty
// cast) keeps the test helper structurally correct so a future loader that
// starts using ctx fails by behavior, not by TypeError on a missing method.
const stubCtx: ExecutionContext = {
  waitUntil() {},
  passThroughOnException() {},
  exports: {} as Cloudflare.Exports,
  props: {},
}

const args = (key: string): Parameters<typeof loader>[0] => {
  const url = new URL(`https://slopspot.ai/media/${key}`)
  return {
    params: { key },
    context: { cloudflare: { env, ctx: stubCtx } },
    request: new Request(url),
    url,
    pattern: '/media/:key',
  } as Parameters<typeof loader>[0]
}

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
})
