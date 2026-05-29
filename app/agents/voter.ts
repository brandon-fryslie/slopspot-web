// [LAW:single-enforcer] The only module that orchestrates voter-agent passes.
// runAgentPass (firehose/scheduled.ts) delegates here for the 'voter' role.
// All z.ai calls go through zai.chat (single z.ai enforcer). All vote writes
// go through setVote (single votes-table enforcer).
//
// [LAW:dataflow-not-control-flow] Same pipeline every pass. Persona config
// (thresholds, votesPerPass) is data flowing through; no per-persona branches.
// The score→intent map is a total function over [0,100] — every score has an
// outcome; the abstain case is a real semantic, not a defensive skip.
//
// [LAW:types-are-the-program] VoterPersonaConfig is parsed at the trust
// boundary (voterConfigSchema). Callers downstream operate on the typed value —
// no persona.config['field'] indexing as unknown at call sites.

import { z } from 'zod'
import type { Persona } from '~/agents/persona'
import { chat } from '~/agents/zai'
import { getFeed } from '~/db/feed'
import { setVote } from '~/db/votes'
import { emit } from '~/observability/metrics'
import type { FeedItem, VoteIntent } from '~/lib/domain'

// [LAW:types-are-the-program] Fail loud on a bad D1 row — a missing field
// crashes here at the trust boundary, not silently as NaN in the score map.
// The cross-field refinement encodes the invariant that the abstain band must
// be non-empty: downvoteThreshold < upvoteThreshold. Inverted thresholds
// collapse the band and make mid-range scores produce incorrect intents.
const voterConfigSchema = z
  .object({
    upvoteThreshold: z.number().min(0).max(100),
    downvoteThreshold: z.number().min(0).max(100),
    // Default allows existing seeds (which lack this field) to work without a migration.
    votesPerPass: z.number().int().positive().default(5),
  })
  .strict()
  .refine((d) => d.downvoteThreshold < d.upvoteThreshold, {
    message: 'downvoteThreshold must be less than upvoteThreshold',
  })

export type VoterPersonaConfig = z.infer<typeof voterConfigSchema>

// [LAW:one-source-of-truth] Persona is selected once by runAgentPass and passed
// here — no re-derivation. runAgentPass owns the null case (no personas → early
// return before this function is called).
export async function runVoterPass(env: Env, persona: Persona): Promise<void> {
  const configResult = voterConfigSchema.safeParse(persona.config)
  if (!configResult.success) {
    throw new Error(
      `voter-pass: persona ${persona.agentId} has invalid config — ${configResult.error.message}`,
    )
  }
  const config = configResult.data

  // [LAW:single-enforcer] getFeed with the agent's id as voterId so myVote is
  // pre-populated for this agent — one query, not a per-post lookup.
  const feed = await getFeed(env, persona.agentId)

  // [LAW:types-are-the-program] flatMap materialises the "judgeable candidate"
  // type — only items this agent can actually score survive. votesPerPass is
  // then applied to items that will reach z.ai, not to the raw filtered list
  // where non-judgeable items could burn cap slots and produce fewer votes than
  // intended.
  // [LAW:dataflow-not-control-flow] Filter is data-driven: no per-item branches,
  // just predicates over values.
  const candidates = feed
    .flatMap((item) => {
      if (item.myVote !== null) return []
      const actor = item.post.origin.actor
      if (actor.kind === 'agent' && actor.agentId === persona.agentId) return []
      const imageUrl = getImageUrl(item, env.SLOPSPOT_SITE_URL)
      if (imageUrl === null) return []
      return [{ item, imageUrl }]
    })
    .slice(0, config.votesPerPass)

  console.log('voter-pass: starting', {
    agentId: persona.agentId,
    displayName: persona.displayName,
    feedSize: feed.length,
    candidateCount: candidates.length,
  })

  emit('slopspot.voter.pass', { agent_id: persona.agentId, outcome: 'fired' }, 1)

  for (const { item, imageUrl } of candidates) {
    await judgeAndVote(item, imageUrl, persona, config, env)
  }
}

// Pure extraction: returns the public image URL for judgeable feed items, null
// for anything the voter cannot score (non-generation, not yet succeeded,
// non-image output, or an unexpected URL format).
// [LAW:one-source-of-truth] SLOPSPOT_SITE_URL is the single base for outbound
// URL construction — callers never concatenate it ad-hoc.
function getImageUrl(item: FeedItem, siteUrl: string): string | null {
  const content = item.post.content
  if (content.kind !== 'generation') return null
  if (content.status.kind !== 'succeeded') return null
  const output = content.status.output
  if (output.kind !== 'image') return null
  if (!output.url.startsWith('/media/')) return null
  return `${siteUrl}${output.url}`
}

async function judgeAndVote(
  item: FeedItem,
  imageUrl: string,
  persona: Persona,
  config: VoterPersonaConfig,
  env: Env,
): Promise<void> {
  const postId = item.post.id

  // [LAW:single-enforcer] All z.ai calls go through chat(). voter.ts has zero
  // knowledge of the z.ai SDK or HTTP shape — it speaks domain types only.
  let score: number
  try {
    const response = await chat(
      {
        persona,
        messages: [
          {
            role: 'user',
            content:
              'Rate this AI-generated image on a scale of 0 to 100 based on your aesthetic criteria. Reply with ONLY a single integer between 0 and 100. No other text.',
          },
        ],
        vision: { imageUrl },
      },
      env,
    )

    // [LAW:types-are-the-program] Strict parse: only a bare decimal integer string
    // is accepted. parseInt('85/100') = 85 — partial-numeric strings would produce
    // plausible-looking scores and silently bypass the prompt's "ONLY a single
    // integer" contract.
    const trimmed = response.trim()
    const parsed = /^\d{1,3}$/.test(trimmed) ? parseInt(trimmed, 10) : NaN
    if (isNaN(parsed) || parsed < 0 || parsed > 100) {
      console.warn('voter-pass: z.ai returned non-integer score; skipping', {
        agentId: persona.agentId,
        postId,
        raw: response.slice(0, 100),
      })
      return
    }
    score = parsed
  } catch (err) {
    console.error('voter-pass: z.ai vision call failed; skipping candidate', {
      agentId: persona.agentId,
      postId,
      err,
    })
    return
  }

  // [LAW:dataflow-not-control-flow] Total map: every score in [0,100] lands in
  // exactly one of three outcomes. No unhandled case, no default branch.
  const intent: VoteIntent =
    score > config.upvoteThreshold ? 1 : score < config.downvoteThreshold ? -1 : 0

  const intentLabel = intent === 1 ? 'upvote' : intent === -1 ? 'downvote' : 'abstain'

  console.log('voter-pass: judgment', {
    agentId: persona.agentId,
    postId,
    score,
    intent: intentLabel,
  })

  // [LAW:single-enforcer] setVote is the votes-table writer. Abstain (0) is a
  // real semantic outcome — skip the write, not a null-guard on a missing value.
  // For non-abstain intents: metric emits only after the write succeeds.
  // post_not_found (race between getFeed and setVote) and D1 throws both log and
  // skip the candidate — one error doesn't abort remaining candidates.
  if (intent !== 0) {
    let result
    try {
      result = await setVote({ postId, voterId: persona.agentId, value: intent }, { env })
    } catch (err) {
      console.error('voter-pass: setVote threw; skipping candidate', {
        agentId: persona.agentId,
        postId,
        err,
      })
      return
    }
    if (!result.ok) {
      console.warn('voter-pass: setVote failed; vote not recorded', {
        agentId: persona.agentId,
        postId,
        reason: result.reason,
      })
      return
    }
  }

  emit('slopspot.voter.vote', { agent_id: persona.agentId, intent: intentLabel }, 1)
}
