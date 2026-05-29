// Candidate image extracted from a seed URL. pageUrl is the canonical URL to
// submit as the found post; imageUrl is used for z.ai vision judgment only.
export type Candidate = {
  pageUrl: string
  imageUrl: string
  title: string
}

// [LAW:single-enforcer] All URL safety enforcement for extracted strings flows
// through safeHttpUrl. Candidate URLs come from untrusted HTML/JSON; rejecting
// non-http(s) schemes here ensures javascript:/data:/file: can never reach the
// /api/found submission or the z.ai vision call.
export function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

// Extract an og:image, og:url, and og:title from an HTML string.
// Both attribute orderings (property before content, content before property)
// are handled — browsers accept either and real sites use both.
export function extractOgMeta(html: string, pageUrl: string): Candidate | null {
  const imageMatch =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
  if (!imageMatch) return null

  const imageUrl = safeHttpUrl(imageMatch[1].trim())
  if (!imageUrl) return null

  const titleMatch =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ??
    html.match(/<title[^>]*>([^<]+)<\/title>/i)
  const title = titleMatch ? titleMatch[1].trim() : 'Untitled'

  const urlMatch =
    html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i)
  const canonicalUrl = urlMatch ? safeHttpUrl(urlMatch[1].trim()) : null

  return { pageUrl: canonicalUrl ?? pageUrl, imageUrl, title }
}

// Parse a Civitai /api/v1/images response and extract candidates.
// Shape: { items: [{ url: string, meta?: { prompt?: string } }] }
export function parseCivitaiResponse(data: unknown): Candidate[] {
  if (typeof data !== 'object' || data === null) return []
  const items = (data as Record<string, unknown>).items
  if (!Array.isArray(items)) return []
  const candidates: Candidate[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const { url, meta, id } = item as Record<string, unknown>
    const imageUrl = typeof url === 'string' ? safeHttpUrl(url) : null
    if (!imageUrl) continue
    const prompt =
      typeof meta === 'object' && meta !== null
        ? (meta as Record<string, unknown>).prompt
        : undefined
    const title =
      typeof prompt === 'string' && prompt.length > 0
        ? prompt.slice(0, 200)
        : `AI image ${id ?? ''}`
    const pageUrl =
      typeof id === 'number' || typeof id === 'string'
        ? `https://civitai.com/images/${id}`
        : imageUrl
    candidates.push({ pageUrl, imageUrl, title: String(title) })
  }
  return candidates
}

// Parse a Lexica /api/v1/search response and extract candidates.
// Shape: { images: [{ id: string, src: string, prompt: string }] }
export function parseLexicaResponse(data: unknown): Candidate[] {
  if (typeof data !== 'object' || data === null) return []
  const images = (data as Record<string, unknown>).images
  if (!Array.isArray(images)) return []
  const candidates: Candidate[] = []
  for (const img of images) {
    if (typeof img !== 'object' || img === null) continue
    const { src, prompt, id } = img as Record<string, unknown>
    const imageUrl = typeof src === 'string' ? safeHttpUrl(src) : null
    if (!imageUrl) continue
    const title =
      typeof prompt === 'string' && prompt.length > 0 ? prompt.slice(0, 200) : 'AI image'
    const pageUrl =
      typeof id === 'string' && id.length > 0
        ? `https://lexica.art/prompt/${id}`
        : imageUrl
    candidates.push({ pageUrl, imageUrl, title })
  }
  return candidates
}

// [LAW:dataflow-not-control-flow] fetchCandidates always runs the same steps;
// content-type decides which parser runs — not whether parsing runs.
export async function fetchCandidates(seedUrl: string): Promise<Candidate[]> {
  let resp: Response
  try {
    resp = await fetch(seedUrl, {
      headers: { 'User-Agent': 'SlopSpot-Discoverer/1.0 (https://slopspot.ai)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    console.warn('discoverer: fetch failed', { seedUrl, err: String(err) })
    return []
  }

  if (!resp.ok) {
    console.warn('discoverer: non-2xx response', { seedUrl, status: resp.status })
    return []
  }

  const contentType = resp.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    let json: unknown
    try {
      json = await resp.json()
    } catch {
      console.warn('discoverer: JSON parse failed', { seedUrl })
      return []
    }
    // Try known JSON source shapes; whichever returns non-empty wins.
    const civitai = parseCivitaiResponse(json)
    if (civitai.length > 0) return civitai
    const lexica = parseLexicaResponse(json)
    return lexica
  }

  if (contentType.includes('text/html')) {
    let html: string
    try {
      html = await resp.text()
    } catch {
      console.warn('discoverer: body read failed', { seedUrl })
      return []
    }
    const candidate = extractOgMeta(html, seedUrl)
    return candidate ? [candidate] : []
  }

  console.warn('discoverer: unrecognised content-type', { seedUrl, contentType })
  return []
}
