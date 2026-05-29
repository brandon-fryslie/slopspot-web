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
import { pickPersona, type Persona } from '~/agents/persona'
import { chat } from '~/agents/zai'
import { getFeed } from '~/db/feed'
import { setVote } from '~/db/votes'
import { emit } from '~/observability/metrics'
import type { FeedItem, PostId, VoteIntent } from '~/lib/domain'

// [LAW:types-are-the-program] Fail loud on a bad D1 row — a missing field
// crashes here at the trust boundary, not silently as NaN in the score map.
const voterConfigSchema = z
  .object({
    upvoteThreshold: z.number().min(0).max(100),
    downvoteThreshold: z.number().min(0).max(100),
    // Default allows existing seeds (which lack this field) to work without a migration.
    votesPerPass: z.number().int().positive().default(5),
  })
  .strict()

export type VoterPersonaConfig = z.infer<typeof voterConfigSchema>

export async function runVoterPass(env: Env, scheduledTimeMs: number): Promise<void> {
  const persona = await pickPersona(env, 'voter', scheduledTimeMs)
  if (persona === null) {
    console.log('voter-pass: no voter personas configured; skipping')
    return
  }

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

  // [LAW:dataflow-not-control-flow] Filter is data-driven: candidates are posts
  // where this agent hasn't voted yet and didn't author the post (invariant for
  // later when generator + voter identities can overlap).
  const candidates = feed
    .filter((item) => {
      if (item.myVote !== null) return false
      const actor = item.post.origin.actor
      return !(actor.kind === 'agent' && actor.agentId === persona.agentId)
    })
    .slice(0, config.votesPerPass)

  console.log('voter-pass: starting', {
    agentId: persona.agentId,
    displayName: persona.displayName,
    feedSize: feed.length,
    candidateCount: candidates.length,
    scheduledTimeMs,
  })

  emit('slopspot.voter.pass', { agent_id: persona.agentId, outcome: 'fired' }, 1)

  for (const item of candidates) {
    await judgeAndVote(item, persona, config, env)
  }
}

async function judgeAndVote(
  item: FeedItem,
  persona: Persona,
  config: VoterPersonaConfig,
  env: Env,
): Promise<void> {
  const postId = item.post.id
  const content = item.post.content

  if (content.kind !== 'generation') return
  if (content.status.kind !== 'succeeded') return
  const media = content.status.output
  if (media.kind !== 'image') return

  // media.url is a relative /media/<key> path. Pass a public URL so z.ai
  // fetches the image directly — avoids embedding large base64 payloads in
  // the request body (prod images are 1-5MB; base64 encoding pushes the JSON
  // body past nginx's limit and causes 500s).
  // [LAW:one-source-of-truth] SLOPSPOT_SITE_URL is the single declared base
  // for all outbound URL construction; it matches the custom_domain in
  // wrangler.jsonc and the configured route for this Worker.
  if (!media.url.startsWith('/media/')) {
    console.warn('voter-pass: unexpected media URL format; skipping', { postId, url: media.url })
    return
  }
  const imageUrl = `${env.SLOPSPOT_SITE_URL}${media.url}`

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

    const parsed = parseInt(response.trim(), 10)
    if (isNaN(parsed) || parsed < 0 || parsed > 100) {
      console.warn('voter-pass: z.ai returned non-numeric score; skipping', {
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

  emit('slopspot.voter.vote', { agent_id: persona.agentId, intent: intentLabel }, 1)

  // [LAW:single-enforcer] setVote is the votes-table writer. Abstain (0) is a
  // real semantic outcome — skip the write, not a null-guard on a missing value.
  if (intent !== 0) {
    await setVote({ postId: postId as PostId, voterId: persona.agentId, value: intent }, { env })
  }
}
