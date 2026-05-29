// [LAW:single-enforcer] The only entry point for discoverer-persona-driven
// found-post creation. runAgentPass (firehose/scheduled.ts) delegates here
// for every 'discoverer' role fire. Both the harvest pipeline and the final
// createPost call live here exactly once — callers cannot bypass ingestion or
// URL dedup.
//
// [LAW:dataflow-not-control-flow] Same code path every fire. Variability lives
// in the persona's config (seedUrls, threshold) and in the scored candidates —
// not in branches that conditionally run different work. An empty seedUrls list
// or a pool of below-threshold candidates still runs the full pipeline; it just
// produces zero submissions.
//
// [LAW:types-are-the-program] DiscovererPersonaConfig is the typed projection
// of config_json for role='discoverer'. Parsed here at the trust boundary;
// unknown keys are loud errors (z.strict()) so config typos surface on first
// fire rather than silently neutering the persona.

import { z } from 'zod'
import { createPost } from '~/db/posts'
import { db } from '~/db/client'
import { found } from '~/db/schema'
import { pickPersona } from '~/agents/persona'
import { chat } from '~/agents/zai'
import type { Persona } from '~/agents/persona'

// Maximum candidates to judge per pass — keeps subrequest count safe within
// the Workers 50-subrequest budget (N seedUrls + M judgments + 1 write ≤ 50).
const MAX_CANDIDATES = 10

const discovererPersonaConfigSchema = z
  .object({
    // Pages the discoverer fetches to mine for candidate AI images. Each URL
    // should point to a gallery, feed, or listing page with OG meta tags.
    // v1 uses seedUrls-only (no external search API required).
    seedUrls: z.array(z.string().url()).min(1),
    // Minimum z.ai score (0–100) to accept a candidate for submission.
    judgeThreshold: z.number().min(0).max(100).default(70),
    // Maximum posts to submit per pass. Default 1 keeps the daily quota safe.
    submissionsPerPass: z.number().int().min(1).max(5).default(1),
  })
  .strict()

type DiscovererPersonaConfig = z.infer<typeof discovererPersonaConfigSchema>

type Candidate = {
  pageUrl: string
  imageUrl: string
  title: string
}

type ScoredCandidate = Candidate & { score: number; reaction: string }

function parseDiscovererConfig(
  raw: Record<string, unknown>,
  agentId: string,
): DiscovererPersonaConfig {
  const result = discovererPersonaConfigSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(
      `discoverer persona ${agentId}: config_json failed validation — ${result.error.message}`,
    )
  }
  return result.data
}

// Parse a URL string and return it only if it uses an http or https scheme.
// Both OG meta values (og:image, og:url) come from untrusted HTML; this is
// the single enforcement point that prevents javascript:, data:, file:, and
// other non-http schemes from reaching the stored post URL or the z.ai vision
// call. [LAW:single-enforcer]
function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

// Extract OG-image URL, OG-title, and canonical URL from an HTML string.
// Returns null if no usable OG-image is present — we cannot judge what we
// cannot see. Falls back to the page URL itself for canonical when og:url
// is absent or fails the http(s) check.
function extractOgMeta(
  html: string,
  pageUrl: string,
): Candidate | null {
  const imageMatch = html.match(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  ) ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)

  if (!imageMatch) return null
  const imageUrl = safeHttpUrl(imageMatch[1].trim())
  if (!imageUrl) return null

  const titleMatch =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ??
    html.match(/<title[^>]*>([^<]+)<\/title>/i)

  const title = titleMatch ? titleMatch[1].trim() : 'AI-generated content'

  const canonicalMatch =
    html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i)

  const resolvedUrl = canonicalMatch
    ? (safeHttpUrl(canonicalMatch[1].trim()) ?? pageUrl)
    : pageUrl

  return { pageUrl: resolvedUrl, imageUrl, title }
}

// Fetch a seedUrl and extract its primary OG-image candidate. Returns null on
// any network or parse failure — discovery is best-effort; a broken seed URL
// should not abort the pass for the remaining seeds.
async function fetchCandidate(seedUrl: string): Promise<Candidate | null> {
  let response: Response
  try {
    response = await fetch(seedUrl, {
      headers: { 'User-Agent': 'SlopSpot-Discoverer/1.0' },
      redirect: 'follow',
    })
  } catch {
    console.warn('discoverer: fetch failed for seedUrl', { seedUrl })
    return null
  }

  if (!response.ok) {
    console.warn('discoverer: non-2xx from seedUrl', {
      seedUrl,
      status: response.status,
    })
    return null
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/html')) {
    console.warn('discoverer: non-HTML from seedUrl', { seedUrl, contentType })
    return null
  }

  let html: string
  try {
    html = await response.text()
  } catch {
    console.warn('discoverer: body-read failed for seedUrl', { seedUrl })
    return null
  }

  const candidate = extractOgMeta(html, seedUrl)
  if (!candidate) {
    console.warn('discoverer: no OG-image meta in page', { seedUrl })
  }
  return candidate
}

// Ask the persona to score a candidate image 0–100. The response must start
// with an integer on its own line; everything after is the persona's reaction
// commentary. Returns null when the response does not parse — treat as
// below-threshold rather than aborting the pass.
async function judgeCandidate(
  candidate: Candidate,
  persona: Persona,
  env: Env,
): Promise<ScoredCandidate | null> {
  const prompt = [
    `You are reviewing an AI-generated image found at: ${candidate.pageUrl}`,
    `Title: ${candidate.title}`,
    '',
    'Score this image from 0 to 100 based on how interesting, surprising, or compelling it is as AI-generated content for SlopSpot.',
    '',
    'Respond with ONLY:',
    '- First line: a single integer (0–100)',
    '- Second line (optional): a one-sentence reaction in your persona voice',
  ].join('\n')

  let reply: string
  try {
    reply = await chat(
      {
        persona,
        messages: [{ role: 'user', content: prompt }],
        vision: { imageUrl: candidate.imageUrl },
      },
      env,
    )
  } catch (err) {
    console.warn('discoverer: z.ai judgment failed for candidate', {
      imageUrl: candidate.imageUrl,
      err,
    })
    return null
  }

  const lines = reply.trim().split('\n')
  const score = parseInt(lines[0].trim(), 10)
  if (isNaN(score) || score < 0 || score > 100) {
    console.warn('discoverer: unparseable score from z.ai', {
      reply: reply.slice(0, 200),
    })
    return null
  }

  const reaction = lines[1]?.trim() ?? ''
  return { ...candidate, score, reaction }
}

// Look up which page URLs already have a found post, to avoid duplicates.
// Returns a Set<string> of known URLs. Dedup lives here (not in createPost)
// to keep the writer free of discovery-specific concerns — each submission
// pathway owns its own anti-spam logic.
async function knownFoundUrls(env: Env, urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set()
  const { inArray } = await import('drizzle-orm')
  const rows = await db(env)
    .select({ url: found.url })
    .from(found)
    .where(inArray(found.url, urls))
  return new Set(rows.map((r) => r.url))
}

// [LAW:single-enforcer] One implementation for all discoverer fires.
// Returns without throwing when the pool is empty (bootstrap); throws on
// config parse errors (operator error — surface it loud). Other I/O errors
// (network, z.ai, D1) propagate to runAgentPass which owns metric emission.
export async function runDiscoveryPass(
  env: Env,
  scheduledTimeMs: number,
): Promise<void> {
  const persona = await pickPersona(env, 'discoverer', scheduledTimeMs)
  if (persona === null) {
    console.log('discoverer: no personas for role; skipping')
    return
  }

  const config = parseDiscovererConfig(persona.config, persona.agentId)

  // [LAW:dataflow-not-control-flow] Harvest all seed URLs in parallel —
  // independent fetches, each returns a Candidate or null. Null entries
  // are dropped before judging; nothing downstream branches on their
  // absence. Workers 50-subrequest budget: N parallel fetches here +
  // M sequential judgments below + 1 createPost = well under 50.
  const rawCandidates = await Promise.all(
    config.seedUrls.map((url) => fetchCandidate(url)),
  )
  const candidates: Candidate[] = rawCandidates.filter(
    (c): c is Candidate => c !== null,
  )

  if (candidates.length === 0) {
    console.log('discoverer: no candidates found from seedUrls', {
      agentId: persona.agentId,
      seedUrls: config.seedUrls,
    })
    return
  }

  // Dedup within the current batch (two seedUrls may resolve to the same
  // og:url) and against already-submitted URLs in D1 before spending z.ai calls.
  const seenInBatch = new Set<string>()
  const deduped = candidates.filter((c) => {
    if (seenInBatch.has(c.pageUrl)) return false
    seenInBatch.add(c.pageUrl)
    return true
  })

  const known = await knownFoundUrls(env, deduped.map((c) => c.pageUrl))
  const fresh = deduped.filter((c) => !known.has(c.pageUrl)).slice(0, MAX_CANDIDATES)

  if (fresh.length === 0) {
    console.log('discoverer: all candidates already submitted', {
      agentId: persona.agentId,
    })
    return
  }

  // [LAW:dataflow-not-control-flow] Judge sequentially to respect z.ai rate
  // limits and stay within the subrequest budget on tight passes.
  const scored: ScoredCandidate[] = []
  for (const candidate of fresh) {
    const result = await judgeCandidate(candidate, persona, env)
    if (result !== null) scored.push(result)
  }

  const accepted = scored
    .filter((c) => c.score >= config.judgeThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.submissionsPerPass)

  if (accepted.length === 0) {
    console.log('discoverer: no candidates above threshold', {
      agentId: persona.agentId,
      threshold: config.judgeThreshold,
      scored: scored.map((c) => ({ pageUrl: c.pageUrl, score: c.score })),
    })
    return
  }

  // [LAW:single-enforcer] All posts go through createPost — the same writer
  // used by /api/found and the generator firehose. No agent-mode bypass.
  for (const winner of accepted) {
    const post = await createPost(
      {
        kind: 'found',
        url: winner.pageUrl,
        title: winner.title,
        description: winner.reaction || undefined,
        origin: { actor: { kind: 'agent', agentId: persona.agentId } },
      },
      { env },
    )
    console.log('discoverer: submitted found post', {
      postId: post.id,
      agentId: persona.agentId,
      displayName: persona.displayName,
      pageUrl: winner.pageUrl,
      score: winner.score,
    })
  }
}
