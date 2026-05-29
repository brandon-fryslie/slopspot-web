// [LAW:behavior-not-structure] These tests pin the contracts that guard the
// homelab runner from SSRF:
//   - safeHttpUrl: the sync boundary that rejects bad schemes and literal
//     private-IP/loopback hostnames before any fetch reaches the network.
//   - safeFetch: the redirect-following boundary that validates every Location
//     hop through safeHttpUrl before following it.
//   - Parsers: extractOgMeta, parseCivitaiResponse, parseLexicaResponse —
//     their output feeds directly into the pipeline; contract correctness here
//     determines what gets judged and what gets silently dropped.
//
// None of these tests know about isPrivateHost's internals or safeFetch's
// hop counter. A refactor that keeps the contracts passes; drift breaks them.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  safeHttpUrl,
  safeFetch,
  extractOgMeta,
  parseCivitaiResponse,
  parseLexicaResponse,
} from './og.js'

// ────────────────────────────────────────────────────────────────────────────
// safeHttpUrl — SSRF boundary contract
// ────────────────────────────────────────────────────────────────────────────

describe('safeHttpUrl — scheme gate', () => {
  it('passes http URLs', () => {
    expect(safeHttpUrl('http://civitai.com/images/123')).toBe('http://civitai.com/images/123')
  })

  it('passes https URLs', () => {
    expect(safeHttpUrl('https://lexica.art/prompt/abc')).toBe('https://lexica.art/prompt/abc')
  })

  it('rejects javascript: scheme', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
  })

  it('rejects data: scheme', () => {
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
  })

  it('rejects file: scheme', () => {
    expect(safeHttpUrl('file:///etc/passwd')).toBeNull()
  })

  it('rejects ftp: scheme', () => {
    expect(safeHttpUrl('ftp://example.com/file')).toBeNull()
  })

  it('rejects garbage', () => {
    expect(safeHttpUrl('not-a-url')).toBeNull()
  })
})

describe('safeHttpUrl — IPv4 private-host gate', () => {
  it('rejects localhost', () => {
    expect(safeHttpUrl('http://localhost/admin')).toBeNull()
  })

  it('rejects 127.0.0.1', () => {
    expect(safeHttpUrl('http://127.0.0.1/')).toBeNull()
  })

  it('rejects 10.x RFC1918', () => {
    expect(safeHttpUrl('http://10.0.0.1/')).toBeNull()
  })

  it('rejects 172.16.x RFC1918', () => {
    expect(safeHttpUrl('http://172.16.0.1/')).toBeNull()
  })

  it('rejects 172.31.x RFC1918', () => {
    expect(safeHttpUrl('http://172.31.255.255/')).toBeNull()
  })

  it('passes 172.32.x (just outside RFC1918)', () => {
    expect(safeHttpUrl('http://172.32.0.1/')).not.toBeNull()
  })

  it('rejects 192.168.x RFC1918', () => {
    expect(safeHttpUrl('http://192.168.1.1/')).toBeNull()
  })

  it('rejects 169.254.x link-local', () => {
    expect(safeHttpUrl('http://169.254.169.254/latest/meta-data/')).toBeNull()
  })

  it('rejects 0.x reserved', () => {
    expect(safeHttpUrl('http://0.0.0.1/')).toBeNull()
  })
})

describe('safeHttpUrl — IPv6 private-host gate', () => {
  it('rejects ::1 loopback', () => {
    expect(safeHttpUrl('http://[::1]/')).toBeNull()
  })

  it('rejects fe80:: link-local', () => {
    expect(safeHttpUrl('http://[fe80::1]/')).toBeNull()
  })

  it('rejects fc00:: unique-local', () => {
    expect(safeHttpUrl('http://[fc00::1]/')).toBeNull()
  })

  it('rejects fd00:: unique-local', () => {
    expect(safeHttpUrl('http://[fd12:3456:789a::1]/')).toBeNull()
  })

  it('rejects ::ffff: IPv4-mapped (may embed private range)', () => {
    expect(safeHttpUrl('http://[::ffff:192.168.1.1]/')).toBeNull()
  })

  it('passes a legitimate public IPv6 address', () => {
    expect(safeHttpUrl('http://[2001:db8::1]/')).not.toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// safeFetch — redirect contract
// ────────────────────────────────────────────────────────────────────────────

function mockFetchSequence(responses: Array<{ status: number; headers?: Record<string, string>; body?: string }>) {
  let call = 0
  return vi.fn(async (_url: string, _init: RequestInit) => {
    const r = responses[call++]
    if (!r) throw new Error('fetch called more times than mocked')
    return new Response(r.body ?? '', {
      status: r.status,
      headers: r.headers ?? {},
    })
  })
}

describe('safeFetch — redirect validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('follows a redirect with an absolute safe Location', async () => {
    const mockFetch = mockFetchSequence([
      { status: 301, headers: { location: 'https://cdn.example.com/image.jpg' } },
      { status: 200, body: 'image-data' },
    ])
    vi.stubGlobal('fetch', mockFetch)

    const resp = await safeFetch('https://civitai.com/image', {})
    expect(resp.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch).toHaveBeenLastCalledWith('https://cdn.example.com/image.jpg', expect.objectContaining({ redirect: 'manual' }))
  })

  it('resolves a relative Location header against the current URL', async () => {
    const mockFetch = mockFetchSequence([
      { status: 302, headers: { location: '/v2/image.jpg' } },
      { status: 200, body: 'image-data' },
    ])
    vi.stubGlobal('fetch', mockFetch)

    const resp = await safeFetch('https://civitai.com/original', {})
    expect(resp.status).toBe(200)
    expect(mockFetch).toHaveBeenLastCalledWith('https://civitai.com/v2/image.jpg', expect.anything())
  })

  it('throws when a redirect Location points to a private IP', async () => {
    const mockFetch = mockFetchSequence([
      { status: 301, headers: { location: 'http://10.0.0.1/internal' } },
    ])
    vi.stubGlobal('fetch', mockFetch)

    await expect(safeFetch('https://civitai.com/image', {})).rejects.toThrow('disallowed URL')
  })

  it('throws when a redirect Location points to a link-local IP', async () => {
    const mockFetch = mockFetchSequence([
      { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } },
    ])
    vi.stubGlobal('fetch', mockFetch)

    await expect(safeFetch('https://example.com/img', {})).rejects.toThrow('disallowed URL')
  })

  it('returns the response directly when there is no redirect', async () => {
    const mockFetch = mockFetchSequence([{ status: 200, body: 'ok' }])
    vi.stubGlobal('fetch', mockFetch)

    const resp = await safeFetch('https://example.com/image.jpg', {})
    expect(resp.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('throws after MAX_REDIRECT_HOPS redirects', async () => {
    const loop: Array<{ status: number; headers: Record<string, string> }> = Array.from(
      { length: 10 },
      (_, i) => ({
        status: 301,
        headers: { location: `https://example.com/hop${i + 1}` },
      }),
    )
    vi.stubGlobal('fetch', mockFetchSequence(loop))

    await expect(safeFetch('https://example.com/start', {})).rejects.toThrow('too many redirects')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// extractOgMeta — OG parsing contract
// ────────────────────────────────────────────────────────────────────────────

describe('extractOgMeta', () => {
  it('extracts og:image, og:title, og:url in property-before-content order', () => {
    const html = `
      <meta property="og:image" content="https://example.com/img.jpg">
      <meta property="og:title" content="Cool Image">
      <meta property="og:url" content="https://example.com/page">
    `
    const c = extractOgMeta(html, 'https://example.com/seed')
    expect(c).not.toBeNull()
    expect(c!.imageUrl).toBe('https://example.com/img.jpg')
    expect(c!.title).toBe('Cool Image')
    expect(c!.pageUrl).toBe('https://example.com/page')
  })

  it('extracts in content-before-property order', () => {
    const html = `
      <meta content="https://cdn.example.com/img.png" property="og:image">
      <meta content="A Title" property="og:title">
    `
    const c = extractOgMeta(html, 'https://fallback.example.com/')
    expect(c).not.toBeNull()
    expect(c!.imageUrl).toBe('https://cdn.example.com/img.png')
    expect(c!.title).toBe('A Title')
  })

  it('falls back to <title> when og:title is absent', () => {
    const html = `
      <title>Fallback Title</title>
      <meta property="og:image" content="https://example.com/img.jpg">
    `
    const c = extractOgMeta(html, 'https://example.com/')
    expect(c!.title).toBe('Fallback Title')
  })

  it('falls back to pageUrl when og:url is absent', () => {
    const html = `<meta property="og:image" content="https://example.com/img.jpg">`
    const c = extractOgMeta(html, 'https://seed.example.com/')
    expect(c!.pageUrl).toBe('https://seed.example.com/')
  })

  it('returns null when og:image is absent', () => {
    const html = `<meta property="og:title" content="Title Only">`
    expect(extractOgMeta(html, 'https://example.com/')).toBeNull()
  })

  it('returns null when og:image URL fails SSRF validation', () => {
    const html = `<meta property="og:image" content="http://192.168.1.1/img.jpg">`
    expect(extractOgMeta(html, 'https://example.com/')).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// parseCivitaiResponse — Civitai API parsing contract
// ────────────────────────────────────────────────────────────────────────────

describe('parseCivitaiResponse', () => {
  it('extracts candidates with prompt-derived title and civitai.com pageUrl', () => {
    const data = {
      items: [
        { id: 12345, url: 'https://image.civitai.com/abc.jpg', meta: { prompt: 'a beautiful dragon' } },
      ],
    }
    const [c] = parseCivitaiResponse(data)
    expect(c.imageUrl).toBe('https://image.civitai.com/abc.jpg')
    expect(c.pageUrl).toBe('https://civitai.com/images/12345')
    expect(c.title).toBe('a beautiful dragon')
  })

  it('truncates prompt to 200 characters', () => {
    const longPrompt = 'x'.repeat(300)
    const data = { items: [{ id: 1, url: 'https://image.civitai.com/a.jpg', meta: { prompt: longPrompt } }] }
    const [c] = parseCivitaiResponse(data)
    expect(c.title.length).toBe(200)
  })

  it('uses fallback title when prompt is absent', () => {
    const data = { items: [{ id: 99, url: 'https://image.civitai.com/x.jpg' }] }
    const [c] = parseCivitaiResponse(data)
    expect(c.title).toContain('99')
  })

  it('drops items whose imageUrl fails SSRF validation', () => {
    const data = {
      items: [
        { id: 1, url: 'http://10.0.0.1/img.jpg' },
        { id: 2, url: 'https://image.civitai.com/safe.jpg' },
      ],
    }
    const result = parseCivitaiResponse(data)
    expect(result).toHaveLength(1)
    expect(result[0].pageUrl).toBe('https://civitai.com/images/2')
  })

  it('returns [] for non-object input', () => {
    expect(parseCivitaiResponse('not an object')).toEqual([])
    expect(parseCivitaiResponse(null)).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// parseLexicaResponse — Lexica API parsing contract
// ────────────────────────────────────────────────────────────────────────────

describe('parseLexicaResponse', () => {
  it('extracts candidates with prompt title and lexica.art pageUrl', () => {
    const data = {
      images: [{ id: 'abc123', src: 'https://image.lexica.art/full/abc.jpg', prompt: 'cyberpunk city' }],
    }
    const [c] = parseLexicaResponse(data)
    expect(c.imageUrl).toBe('https://image.lexica.art/full/abc.jpg')
    expect(c.pageUrl).toBe('https://lexica.art/prompt/abc123')
    expect(c.title).toBe('cyberpunk city')
  })

  it('drops items whose imageUrl fails SSRF validation', () => {
    const data = {
      images: [
        { id: 'bad', src: 'http://127.0.0.1/secret', prompt: 'test' },
        { id: 'ok', src: 'https://image.lexica.art/ok.jpg', prompt: 'ok' },
      ],
    }
    const result = parseLexicaResponse(data)
    expect(result).toHaveLength(1)
    expect(result[0].imageUrl).toBe('https://image.lexica.art/ok.jpg')
  })

  it('returns [] for non-object input', () => {
    expect(parseLexicaResponse(null)).toEqual([])
  })
})
