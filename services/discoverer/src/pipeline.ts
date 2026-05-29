// [LAW:dataflow-not-control-flow] Same pipeline every run: fetch → dedup →
// judge → accept → submit. Persona config + scored candidates decide what
// submits; the pipeline never branches to skip stages.
//
// [LAW:single-enforcer] All submissions go through POST /api/found — the same
// trust boundary human users hit. No createPost bypass.

import { writeFile, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { type D1Config, d1Query } from './d1.js'
import { fetchCandidates, safeFetch } from './og.js'
import { judgeCandidate } from './zai.js'
import { pushMetric } from './metrics.js'

const MAX_CANDIDATES = 10

// [LAW:types-are-the-program] z.strict() rejects unknown keys — config typos
// surface as errors on first run rather than silently skipping stages.
const personaConfigSchema = z
  .object({
    seedUrls: z.array(z.string().url()).min(1),
    judgeThreshold: z.number().min(0).max(100).default(70),
    submissionsPerPass: z.number().int().min(1).max(5).default(1),
  })
  .strict()

type PersonaConfig = z.infer<typeof personaConfigSchema>

type Persona = {
  agentId: string
  displayName: string
  personaPrompt: string
  config: PersonaConfig
}

type D1PersonaRow = {
  agent_id: string
  display_name: string
  persona_prompt: string
  model_id: string
  config_json: string
}

type D1FoundRow = {
  url: string
}

export type PipelineConfig = {
  d1: D1Config
  zaiApiKey: string
  foundEndpoint: string
  metricsEndpoint: string
}

async function loadDiscovererPersonas(d1: D1Config): Promise<Persona[]> {
  const rows = await d1Query<D1PersonaRow>(
    d1,
    "SELECT agent_id, display_name, persona_prompt, model_id, config_json FROM personas WHERE role = 'discoverer' ORDER BY agent_id",
  )
  const personas = rows.flatMap((row) => {
    let raw: unknown
    try {
      raw = JSON.parse(row.config_json)
    } catch {
      console.error(`persona ${row.agent_id}: config_json is malformed JSON`)
      return []
    }
    const result = personaConfigSchema.safeParse(raw)
    if (!result.success) {
      console.error(
        `persona ${row.agent_id}: config_json failed validation — ${result.error.message}`,
      )
      return []
    }
    return [
      {
        agentId: row.agent_id,
        displayName: row.display_name,
        personaPrompt: row.persona_prompt,
        config: result.data,
      },
    ]
  })
  // Distinguish "no rows in D1" from "rows exist but all failed config validation".
  // The latter is a hard configuration error — Nomad log/alerting must see it.
  if (rows.length > 0 && personas.length === 0) {
    console.error(
      `discoverer: all ${rows.length} discoverer persona row(s) failed config validation — check config_json in D1`,
    )
  }
  return personas
}

async function knownFoundUrls(d1: D1Config, urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set()
  const placeholders = urls.map(() => '?').join(',')
  const rows = await d1Query<D1FoundRow>(
    d1,
    `SELECT url FROM found WHERE url IN (${placeholders})`,
    urls,
  )
  return new Set(rows.map((r) => r.url))
}

async function submitFoundPost(
  endpoint: string,
  agentId: string,
  url: string,
  title: string,
  description: string | undefined,
): Promise<string | null> {
  const body: Record<string, string> = { url, title, agentId }
  if (description && description.length > 0) body.description = description

  let resp: Response
  try {
    resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    console.error('discoverer: POST /api/found failed', { url, err: String(err) })
    return null
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '(unreadable)')
    console.error('discoverer: /api/found rejected', {
      status: resp.status,
      url,
      body: body.slice(0, 300),
    })
    return null
  }

  const json = (await resp.json()) as { id?: string }
  return json.id ?? null
}

// Download an image to a temp file and return the local path. GLM rejects CDN
// URLs that redirect to extension-less storage objects (error code 1210); a
// local .jpeg file sidesteps both the redirect and the missing extension.
// Returns null on any fetch/write failure so judging is skipped for that candidate.
async function downloadImageToTemp(url: string): Promise<string | null> {
  let resp: Response
  try {
    // [LAW:single-enforcer] safeFetch validates every redirect hop through
    // safeHttpUrl — a CDN redirect to a private IP is rejected at the boundary.
    resp = await safeFetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'SlopSpot-Discoverer/1.0 (https://slopspot.ai)' },
    })
  } catch (err) {
    console.warn('discoverer: image download failed', { url, err: String(err) })
    return null
  }
  if (!resp.ok) {
    console.warn('discoverer: image download non-2xx', { url, status: resp.status })
    return null
  }
  const contentType = resp.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) {
    console.warn('discoverer: image download non-image content-type', { url, contentType })
    return null
  }
  // GLM rejects images over 5MB; also guards Nomad job memory from oversized external responses.
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024
  const contentLength = resp.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_BYTES) {
    console.warn('discoverer: image too large, skipping', { url, contentLength })
    return null
  }
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpeg'
  const tmpPath = join(tmpdir(), `slopspot-${randomUUID()}.${ext}`)
  try {
    const buf = Buffer.from(await resp.arrayBuffer())
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      console.warn('discoverer: image too large after download, skipping', { url, size: buf.byteLength })
      return null
    }
    await writeFile(tmpPath, buf)
    return tmpPath
  } catch (err) {
    console.warn('discoverer: image write failed', { url, err: String(err) })
    return null
  }
}

// [LAW:single-enforcer] runPersonaPass is the one implementation for all
// discoverer persona fires. All variation lives in the persona config.
async function runPersonaPass(persona: Persona, cfg: PipelineConfig): Promise<void> {
  const { agentId, displayName, config } = persona
  console.log('discoverer: starting pass', { agentId, displayName })

  // [LAW:dataflow-not-control-flow] Fetch all seedUrls in parallel — all run,
  // empty results are dropped before dedup.
  const rawCandidates = (
    await Promise.all(config.seedUrls.map((url) => fetchCandidates(url)))
  ).flat()

  if (rawCandidates.length === 0) {
    console.log('discoverer: no candidates from seedUrls', { agentId })
    await pushMetric(cfg.metricsEndpoint, 'slopspot.discoverer.pass', {
      agent_id: agentId,
      outcome: 'no_candidates',
    }, 1)
    return
  }

  // Dedup within batch first (two seeds may return the same URL), then against D1.
  const seenInBatch = new Set<string>()
  const batchDeduped = rawCandidates.filter((c) => {
    if (seenInBatch.has(c.pageUrl)) return false
    seenInBatch.add(c.pageUrl)
    return true
  })

  const known = await knownFoundUrls(cfg.d1, batchDeduped.map((c) => c.pageUrl))
  const fresh = batchDeduped.filter((c) => !known.has(c.pageUrl)).slice(0, MAX_CANDIDATES)

  if (fresh.length === 0) {
    console.log('discoverer: all candidates already submitted', { agentId })
    await pushMetric(cfg.metricsEndpoint, 'slopspot.discoverer.pass', {
      agent_id: agentId,
      outcome: 'all_known',
    }, 1)
    return
  }

  // Judge sequentially — z.ai rate limits and sequential ordering are safer.
  const scored: Array<{ pageUrl: string; imageUrl: string; title: string; score: number; reaction: string }> = []
  for (const candidate of fresh) {
    // Download to a local file — CDNs like Civitai redirect to extension-less
    // B2 objects, and GLM rejects those as format errors (code 1210).
    const tmpPath = await downloadImageToTemp(candidate.imageUrl)
    if (tmpPath === null) continue
    let result: Awaited<ReturnType<typeof judgeCandidate>>
    try {
      result = await judgeCandidate({
        imageUrl: tmpPath,
        pageUrl: candidate.pageUrl,
        title: candidate.title,
        personaPrompt: persona.personaPrompt,
        apiKey: cfg.zaiApiKey,
      })
    } finally {
      await unlink(tmpPath).catch(() => undefined)
    }
    if (result !== null) {
      scored.push({ ...candidate, score: result.score, reaction: result.reaction })
    }
  }

  const accepted = scored
    .filter((c) => c.score >= config.judgeThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.submissionsPerPass)

  if (accepted.length === 0) {
    console.log('discoverer: no candidates above threshold', {
      agentId,
      threshold: config.judgeThreshold,
      scored: scored.map((c) => ({ url: c.pageUrl, score: c.score })),
    })
    await pushMetric(cfg.metricsEndpoint, 'slopspot.discoverer.pass', {
      agent_id: agentId,
      outcome: 'below_threshold',
    }, 1)
    return
  }

  let submitted = 0
  for (const winner of accepted) {
    const postId = await submitFoundPost(
      cfg.foundEndpoint,
      agentId,
      winner.pageUrl,
      winner.title,
      winner.reaction || undefined,
    )
    if (postId !== null) {
      submitted++
      console.log('discoverer: submitted found post', {
        postId,
        agentId,
        url: winner.pageUrl,
        score: winner.score,
      })
    }
  }

  await pushMetric(cfg.metricsEndpoint, 'slopspot.discoverer.pass', {
    agent_id: agentId,
    outcome: submitted > 0 ? 'submitted' : 'submit_failed',
  }, submitted)
}

// Run all discoverer personas sequentially — keeps z.ai call rate predictable
// and makes the log output readable.
export async function runDiscoveryRound(cfg: PipelineConfig): Promise<void> {
  const personas = await loadDiscovererPersonas(cfg.d1)
  if (personas.length === 0) {
    console.log('discoverer: no discoverer personas found in D1')
    return
  }
  console.log(`discoverer: running ${personas.length} persona(s)`)
  for (const persona of personas) {
    try {
      await runPersonaPass(persona, cfg)
    } catch (err) {
      console.error('discoverer: persona pass threw', { agentId: persona.agentId, err })
      await pushMetric(cfg.metricsEndpoint, 'slopspot.discoverer.pass', {
        agent_id: persona.agentId,
        outcome: 'error',
      }, 1)
    }
  }
}
