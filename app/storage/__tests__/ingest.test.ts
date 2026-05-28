import { Buffer } from 'node:buffer'
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { env, fetchMock } from 'cloudflare:test'
import { ingestImage } from '~/storage/ingest'

// The `ProvidedEnv` augmentation is declared once in
// app/db/__tests__/setup.ts (loaded via vitest setupFiles); module
// augmentations are global within a TypeScript compilation.

const ORIGIN = 'https://cdn.example.com'

describe('ingestImage', () => {
  beforeAll(() => fetchMock.activate())
  afterEach(() => fetchMock.assertNoPendingInterceptors())

  it('stores bytes at sha256 key and returns matching metadata', async () => {
    const bytes = new Uint8Array(256).fill(0xab)
    fetchMock
      .get(ORIGIN)
      .intercept({ path: '/image.jpg' })
      .reply(200, Buffer.from(bytes), { headers: { 'content-type': 'image/jpeg' } })

    const result = await ingestImage(`${ORIGIN}/image.jpg`, env)

    expect(result.size).toBe(256)
    expect(result.contentType).toBe('image/jpeg')
    expect(result.url).toBe(`/media/${result.key}`)
    expect(result.key).toMatch(/^[0-9a-f]{64}$/)

    const stored = await env.MEDIA.get(result.key)
    expect(stored).not.toBeNull()
    const storedBytes = new Uint8Array(await stored!.arrayBuffer())
    expect(storedBytes).toEqual(bytes)
  })

  it('dedup: identical bytes produce the same key (one stored object)', async () => {
    const bytes = new Uint8Array(16).fill(0xcd)
    fetchMock.get(ORIGIN).intercept({ path: '/img1.jpg' }).reply(200, Buffer.from(bytes), { headers: { 'content-type': 'image/jpeg' } })
    fetchMock.get(ORIGIN).intercept({ path: '/img2.jpg' }).reply(200, Buffer.from(bytes), { headers: { 'content-type': 'image/jpeg' } })

    const r1 = await ingestImage(`${ORIGIN}/img1.jpg`, env)
    const r2 = await ingestImage(`${ORIGIN}/img2.jpg`, env)

    expect(r1.key).toBe(r2.key)
  })

  it('throws with upstream URL in message on non-2xx response', async () => {
    fetchMock
      .get(ORIGIN)
      .intercept({ path: '/missing.jpg' })
      .reply(404, 'not found')

    await expect(ingestImage(`${ORIGIN}/missing.jpg`, env)).rejects.toThrow(
      `${ORIGIN}/missing.jpg`,
    )
  })

  it('throws with content-type in message on non-image response', async () => {
    fetchMock
      .get(ORIGIN)
      .intercept({ path: '/doc.html' })
      .reply(200, '<html/>', { headers: { 'content-type': 'text/html' } })

    await expect(ingestImage(`${ORIGIN}/doc.html`, env)).rejects.toThrow('text/html')
  })

  it('throws on empty body', async () => {
    fetchMock
      .get(ORIGIN)
      .intercept({ path: '/empty.jpg' })
      .reply(200, '', { headers: { 'content-type': 'image/jpeg' } })

    await expect(ingestImage(`${ORIGIN}/empty.jpg`, env)).rejects.toThrow('empty body')
  })

  it('throws when body exceeds the 20 MB cap', async () => {
    const oversized = new Uint8Array(20 * 1024 * 1024 + 1)
    fetchMock
      .get(ORIGIN)
      .intercept({ path: '/huge.jpg' })
      .reply(200, Buffer.from(oversized), { headers: { 'content-type': 'image/jpeg' } })

    await expect(ingestImage(`${ORIGIN}/huge.jpg`, env)).rejects.toThrow('exceeds')
  })
})
