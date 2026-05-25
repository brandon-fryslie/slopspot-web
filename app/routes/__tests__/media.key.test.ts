import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { loader } from '~/routes/media.$key'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}

// Constructs a minimal LoaderArgs for the media.$key route.
// The loader only accesses params.key and context.cloudflare.env.MEDIA.
const args = (key: string): Parameters<typeof loader>[0] =>
  ({
    params: { key },
    context: { cloudflare: { env } },
    request: new Request(`https://slopspot.ai/media/${key}`),
  }) as Parameters<typeof loader>[0]

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
