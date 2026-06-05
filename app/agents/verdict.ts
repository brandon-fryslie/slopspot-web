// [LAW:single-enforcer] The verdict narration — the one place a recorded vote becomes a citizen's
// spoken verdict (slopspot-voice-w2v.1). It NARRATES a completed act: the vote already committed (the
// act-layer truth) before this runs, and this only reads the snapshot + persists the utterance.
// [LAW:one-way-deps] voice → domain (ids only); a narration failure can never corrupt the vote.

import { utter, type JudgedSlop, type PersonaRef } from '~/lib/voice'
import { getPersona } from '~/agents/persona'
import { getPostById } from '~/db/feed'
import { recordUtterance } from '~/db/utterances'
import { AgentId, PostId, type Content, type Origin, type VoteValue } from '~/lib/domain'

// The slop's authored prompt — what the critic's verdict is about. A generation's is its genome
// utterance (the composed prompt); a found slop's is its title; an upload has no authored prompt.
// [LAW:dataflow-not-control-flow] exhaustive over the closed Content union — a new kind fails the build.
function gistPrompt(content: Content): string {
  switch (content.kind) {
    case 'generation':
      return content.genome.utterance
    case 'found':
      return content.title
    case 'upload':
      return ''
  }
}

// The slop's MAKER — load-bearing for the feud (.2): a generation is AUTHORED by a persona, so its
// author is the maker; a found/upload slop has no maker-persona (the finder/uploader is not the author),
// so `null`. [LAW:dataflow-not-control-flow] the origin variant decides, no per-kind guard chain.
function makerHandleOf(origin: Origin): AgentId | null {
  return origin.kind === 'authored' ? origin.author.agentId : null
}

// Narrate a citizen's vote as a persisted verdict utterance. Fires only for an agent vote of -1|1 (a
// retract has no verdict to narrate). A human voter (no persona row) is not a citizen and utters
// nothing — it returns by data, not a guard the caller writes. The voice degrades any compose failure
// to Withheld{unavailable} (speak() in voice.ts); recordUtterance persists whichever arm — a silence is
// a real recorded row. The CALLER wraps this so a write failure logs and never breaks the vote response.
export async function narrateVerdict(
  env: Env,
  input: { speaker: string; postId: string; vote: VoteValue; reasoning?: string },
): Promise<void> {
  const persona = await getPersona(env, input.speaker)
  if (persona === null) return // not a citizen — no voice
  const post = await getPostById(env, PostId(input.postId))
  if (post === null) return // the slop vanished before narration (a race) — nothing to narrate

  const ref: PersonaRef = {
    handle: persona.agentId,
    displayName: persona.displayName,
    traits: persona.traits,
  }
  const target: JudgedSlop = {
    slop: { postId: PostId(input.postId), prompt: gistPrompt(post.content) },
    vote: input.vote,
    makerHandle: makerHandleOf(post.origin),
    ...(input.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
  }

  const utterance = utter(ref, 'verdict', target)
  await recordUtterance(env, {
    speaker: input.speaker,
    occasion: 'verdict',
    targetPostId: input.postId,
    utterance,
  })
}
