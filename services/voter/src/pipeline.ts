// [LAW:dataflow-not-control-flow] Same pipeline every pass: fetch personas →
// fetch feed → filter unvoted → judge via z.ai vision → POST vote. Persona
// config (thresholds, votesPerPass) is data flowing through; no per-persona
// branches. An empty candidate list is the no-op case — zero iterations, not
// a conditional skip.
//
// [LAW:single-enforcer] All votes go through POST /api/posts/:id/vote — the
// same trust boundary humans hit. No direct D1 write from this service.
// All vision judgments go through judgeImage (zai.ts).

import { z } from 'zod'
import { type D1Config, d1Query } from './d1.js'
import { judgeImage, type Judgment } from './zai.js'
import { pushMetric } from './metrics.js'
import { shouldFireNow } from './scheduler.js'

// [LAW:types-are-the-program] z.strict() rejects unknown keys — a config typo
// surfaces as an error on first run rather than silently mis-voting.
const voterConfigSchema = z
  .object({
    upvoteThreshold: z.number().min(0).max(100),
    downvoteThreshold: z.number().min(0).max(100),
    votesPerPass: z.number().int().positive().default(5),
    expectedDailyFires: z.number().positive(),
    // Bounds: 0 <= startHour < endHour <= 24 (mirrors app/lib/scheduler.ts constraints).
    activeHoursUtc: z
      .object({
        startHour: z.number().int().min(0).max(23),
        endHour: z.number().int().min(1).max(24),
      })
      .refine((d) => d.startHour < d.endHour, {
        message: 'startHour must be less than endHour',
      })
      .optional(),
  })
  .strict()
  .refine((d) => d.downvoteThreshold < d.upvoteThreshold, {
    message: 'downvoteThreshold must be less than upvoteThreshold',
  })

type VoterConfig = z.infer<typeof voterConfigSchema>

type VoterPersona = {
  agentId: string
  displayName: string
  personaPrompt: string
  config: VoterConfig
}

// Minimal types for the feed API response — only the fields the voter needs.
type FeedPost = {
  id: string
  content: {
    kind: string
    status?: { kind: string; output?: { kind: string; url: string } }
  }
  origin: { actor: { kind: string; agentId?: string } }
}

type FeedItem = {
  post: FeedPost
  myVote: number | null
}

type D1PersonaRow = {
  agent_id: string
  display_name: string
  persona_prompt: string
  config_json: string
}

export type PipelineConfig = {
  d1: D1Config
  zaiApiKey: string
  siteUrl: string
  metricsEndpoint: string
}

async function loadVoterPersonas(d1: D1Config): Promise<VoterPersona[]> {
  const rows = await d1Query<D1PersonaRow>(
    d1,
    "SELECT agent_id, display_name, persona_prompt, config_json FROM personas WHERE role = 'voter' ORDER BY agent_id",
  )
  const personas = rows.flatMap((row) => {
    let raw: unknown
    try {
      raw = JSON.parse(row.config_json)
    } catch {
      console.error(`voter: persona ${row.agent_id}: config_json is malformed JSON`)
      return []
    }
    const result = voterConfigSchema.safeParse(raw)
    if (!result.success) {
      console.error(
        `voter: persona ${row.agent_id}: config_json failed validation — ${result.error.message}`,
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
  if (rows.length > 0 && personas.length === 0) {
    console.error(
      `voter: all ${rows.length} voter persona row(s) failed config validation — check config_json in D1`,
    )
  }
  return personas
}

async function fetchFeed(siteUrl: string, agentId: string): Promise<FeedItem[]> {
  const url = `${siteUrl}/api/feed?voterId=${encodeURIComponent(agentId)}`
  const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!resp.ok) {
    const body = await resp.text().catch(() => '(unreadable)')
    throw new Error(`voter: feed fetch failed: ${resp.status} — ${body.slice(0, 200)}`)
  }
  const json = (await resp.json()) as { items: FeedItem[] }
  return json.items
}

// Extract the public image URL for a feed item. Returns null for anything
// the voter cannot score (non-generation, not succeeded, non-image output, or
// URL not served from /media/).
function imageUrl(item: FeedItem, siteUrl: string): string | null {
  const content = item.post.content
  if (content.kind !== 'generation') return null
  if (content.status?.kind !== 'succeeded') return null
  const output = content.status.output
  if (!output || output.kind !== 'image') return null
  if (!output.url.startsWith('/media/')) return null
  return `${siteUrl}${output.url}`
}

async function runPersonaPass(persona: VoterPersona, cfg: PipelineConfig): Promise<void> {
  const { agentId, displayName, config } = persona
  console.log('voter: starting pass', { agentId, displayName })

  const feed = await fetchFeed(cfg.siteUrl, agentId)

  // [LAW:dataflow-not-control-flow] flatMap materialises the judgeable
  // candidate type — only items this agent can score survive into the slice.
  // votesPerPass applies to judgeable items only so non-generation posts don't
  // consume cap slots.
  const candidates = feed
    .flatMap((item) => {
      if (item.myVote !== null) return []
      const actor = item.post.origin.actor
      if (actor.kind === 'agent' && actor.agentId === agentId) return []
      const url = imageUrl(item, cfg.siteUrl)
      if (url === null) return []
      return [{ item, url }]
    })
    .slice(0, config.votesPerPass)

  console.log('voter: candidates', { agentId, feedSize: feed.length, candidateCount: candidates.length })

  await pushMetric(cfg.metricsEndpoint, 'slopspot.voter.pass', { agent_id: agentId, outcome: 'fired' }, 1)

  for (const { item, url } of candidates) {
    await judgeAndVote(item, url, persona, cfg)
  }
}

// [LAW:dataflow-not-control-flow] Uniform log shape per candidate including
// abstains — the log consumer never branches on intent to find reasoning.
function logVoteCandidate(opts: {
  persona: VoterPersona
  postId: string
  judgment: Judgment
  intent: 'upvote' | 'downvote' | 'abstain'
}): void {
  const { persona, postId, judgment, intent } = opts
  // One structured JSON line per candidate — parseable by homelab log tooling.
  process.stdout.write(
    JSON.stringify({
      ts: new Date().toISOString(),
      persona: { agentId: persona.agentId, displayName: persona.displayName },
      postId,
      score: judgment.score,
      reasoning: judgment.reasoning,
      intent,
    }) + '\n',
  )
}

async function judgeAndVote(
  item: FeedItem,
  url: string,
  persona: VoterPersona,
  cfg: PipelineConfig,
): Promise<void> {
  const postId = item.post.id

  let judgment: Judgment | null
  try {
    judgment = await judgeImage({ imageUrl: url, personaPrompt: persona.personaPrompt, apiKey: cfg.zaiApiKey })
  } catch (err) {
    console.error('voter: vision failed; skipping', { agentId: persona.agentId, postId, error: String(err) })
    return
  }

  if (judgment === null) {
    console.warn('voter: unparseable score; skipping', { agentId: persona.agentId, postId })
    return
  }

  const { upvoteThreshold, downvoteThreshold } = persona.config
  const intentValue = judgment.score > upvoteThreshold ? 1 : judgment.score < downvoteThreshold ? -1 : 0
  const intent: 'upvote' | 'downvote' | 'abstain' =
    intentValue === 1 ? 'upvote' : intentValue === -1 ? 'downvote' : 'abstain'

  logVoteCandidate({ persona, postId, judgment, intent })

  if (intentValue === 0) {
    await pushMetric(cfg.metricsEndpoint, 'slopspot.voter.vote', { agent_id: persona.agentId, intent }, 1)
    return
  }

  try {
    const voteUrl = `${cfg.siteUrl}/api/posts/${postId}/vote`
    const resp = await fetch(voteUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: intentValue, agentId: persona.agentId, reasoning: judgment.reasoning }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '(unreadable)')
      console.error('voter: POST vote failed', { agentId: persona.agentId, postId, status: resp.status, body: body.slice(0, 200) })
      return
    }
  } catch (err) {
    console.error('voter: POST vote threw', { agentId: persona.agentId, postId, error: String(err) })
    return
  }

  await pushMetric(cfg.metricsEndpoint, 'slopspot.voter.vote', { agent_id: persona.agentId, intent }, 1)
}

// [LAW:dataflow-not-control-flow] Same pipeline every tick: load all personas,
// filter to those due now via the stochastic scheduler, run passes sequentially.
// An empty due list is the no-op tick — zero iterations, not a conditional skip.
// scheduledTime drives the deterministic hash so the same tick always picks the
// same set of personas (reproducible for debugging).
export async function runVotingRound(cfg: PipelineConfig, scheduledTime: Date): Promise<void> {
  const personas = await loadVoterPersonas(cfg.d1)
  if (personas.length === 0) {
    console.log('voter: no voter personas found in D1')
    return
  }

  const due = personas.filter((p) =>
    shouldFireNow(
      p.agentId,
      { expectedDailyFires: p.config.expectedDailyFires, activeHoursUtc: p.config.activeHoursUtc },
      scheduledTime,
    ),
  )

  console.log('voter: scheduler result', {
    total: personas.length,
    due: due.length,
    scheduledTime: scheduledTime.toISOString(),
  })

  for (const persona of due) {
    try {
      await runPersonaPass(persona, cfg)
    } catch (err) {
      console.error('voter: persona pass threw', { agentId: persona.agentId, err: String(err) })
      await pushMetric(cfg.metricsEndpoint, 'slopspot.voter.pass', { agent_id: persona.agentId, outcome: 'error' }, 1)
    }
  }
}
