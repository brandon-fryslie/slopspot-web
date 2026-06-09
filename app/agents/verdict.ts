// [LAW:single-enforcer] The verdict narration — the one place a recorded vote becomes a citizen's
// spoken verdict (slopspot-voice-w2v.1). It NARRATES a completed act: the vote already committed (the
// act-layer truth) before this runs, and this only reads the snapshot + persists the utterance.
// [LAW:one-way-deps] voice → domain (ids only); a narration failure can never corrupt the vote.

import { utter, type JudgedSlop, type ReVoice, type ReplyExchange, type SlopGist, type VoicedPersonaRef } from '~/lib/voice'
import { getPersona } from '~/agents/persona'
import { getPostById } from '~/db/feed'
import { db } from '~/db/client'
import { coPresentVerdicts, pruneRepliesExcept, recordUtterance } from '~/db/utterances'
import { feudStandingBetween } from '~/db/feud'
import { effectiveTraits } from '~/db/character'
import { callHaiku } from '~/lib/haiku'
import { AgentId, PostId, type Content, type Origin, type VerdictDisposition, type VoteValue } from '~/lib/domain'

// [LAW:one-way-deps][capabilities-over-context] The agent layer binds the re-voice TRANSPORT over the
// shared callHaiku leaf, capturing env, and hands the ONE ability into the pure voice layer — voice.ts
// never sees env or Anthropic. [LAW:dataflow-not-control-flow] a transport failure returns null (not a
// throw), so composeVerdict degrades to its verbatim floor; the catch keeps a re-voice failure from
// corrupting the surrounding narration. (slopspot-voice-w2v.7)
const REVOICE_MAX_TOKENS = 200
function makeReVoice(env: Env): ReVoice {
  return async (prompt) => {
    try {
      return await callHaiku(env, { system: prompt.system, user: prompt.user, maxTokens: REVOICE_MAX_TOKENS })
    } catch (err) {
      console.error('verdict re-voice: Haiku call failed; falling back to verbatim reasoning', err)
      return null
    }
  }
}

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

  // [LAW:dataflow-not-control-flow] The register the citizen speaks in is its ACCRETED character: base
  // sensibility tinted by what it has blessed/buried over time (slopspot-voice-w2v.3). The historical
  // vector replaces the static one as the DATA the verdict re-voice reads — no branch, no second voice
  // path. [LAW:types-are-the-program] the verdict speaker is a VoicedPersonaRef: traits + personaPrompt
  // REQUIRED, so the re-voice reads both with no presence-guard. This sits in the caller-try/caught
  // narration, so a read failure logs and leaves the committed vote untouched.
  const ref: VoicedPersonaRef = {
    handle: persona.agentId,
    displayName: persona.displayName,
    traits: await effectiveTraits(db(env), input.speaker, persona.traits, new Date()),
    personaPrompt: persona.personaPrompt,
  }
  const target: JudgedSlop = {
    slop: { postId: PostId(input.postId), prompt: gistPrompt(post.content) },
    vote: input.vote,
    makerHandle: makerHandleOf(post.origin),
    ...(input.reasoning !== undefined ? { reasoning: input.reasoning } : {}),
  }

  // FORK C (slopspot-voice-w2v.7): re-voice the verdict in the citizen's register via the injected Haiku
  // transport; degrades to the verbatim floor when the transport cannot speak.
  const utterance = await utter(ref, 'verdict', target, { reVoice: makeReVoice(env) })
  await recordUtterance(env, {
    speaker: input.speaker,
    occasion: 'verdict',
    targetPostId: input.postId,
    utterance,
  })

  // The verdict is recorded; now the Feud Engine reads whether it landed into a disagreement and, if so,
  // fires the exchange. [LAW:one-way-deps] voice → domain: this narrates the now-completed clash, it
  // never alters the vote.
  await narrateExchange(env, { slop: target.slop, speaker: ref, ownVote: input.vote })
}

// blessed (+1) / buried (-1) — the verdict's lean, the same ±1 the vote carries.
function dispositionOf(vote: VoteValue): VerdictDisposition {
  return vote === 1 ? 'blessed' : 'buried'
}

// [LAW:dataflow-not-control-flow] The Feud Engine (slopspot-voice-w2v.2). When a verdict lands OPPOSING
// an incumbent verdict on the same slop, the opposing-verdict data fires a `reply` occasion for BOTH
// citizens — each answers the other, the visible back-and-forth. The tone is the DERIVED standing's
// stance (feudStandingBetween, read from their shared votes, never stored). An empty opponent set reduces
// this to a no-op WITHOUT a guard: the for-each over zero opposing verdicts simply does nothing — the
// data decides whether an exchange happens, not a branch around the work.
//
// Symmetric standing: standing(B,A) counts the same pairs as standing(A,B), so one read tones both
// replies. Each citizen's reply UPSERTS on (speaker, slop, 'reply') — one current answer per citizen per
// slop, the same one-current-utterance model the verdict uses. [LAW:one-source-of-truth]
async function narrateExchange(
  env: Env,
  newcomer: { slop: SlopGist; speaker: VoicedPersonaRef; ownVote: VoteValue },
): Promise<void> {
  const ownDisposition = dispositionOf(newcomer.ownVote)
  const present = await coPresentVerdicts(db(env), newcomer.slop.postId)
  // The incumbent this verdict clashes with: the most-recent verdict (the list is newest-first) whose
  // disposition opposes the newcomer's. A non-citizen or same-leaning critic is not an opponent.
  const opponent = present.find(
    (v) => v.speaker !== newcomer.speaker.handle && v.disposition !== ownDisposition,
  )
  if (opponent === undefined) return // no clash — by data, the exchange does not fire

  const standing = await feudStandingBetween(db(env), newcomer.speaker.handle, opponent.speaker)
  const opponentPersona = await getPersona(env, opponent.speaker)
  if (opponentPersona === null) return // the opponent's persona vanished mid-exchange (a race) — nothing to answer

  // B answers A.
  const newcomerReply: ReplyExchange = {
    slop: newcomer.slop,
    opponent: { handle: opponent.speaker as AgentId, displayName: opponent.displayName, disposition: opponent.disposition },
    ownDisposition,
    standing,
  }
  // A answers B — the standing is symmetric, so the same read tones the incumbent's reply.
  const incumbentReply: ReplyExchange = {
    slop: newcomer.slop,
    opponent: { handle: newcomer.speaker.handle, displayName: newcomer.speaker.displayName, disposition: ownDisposition },
    ownDisposition: opponent.disposition,
    standing,
  }
  // [LAW:dataflow-not-control-flow] The incumbent speaks in its OWN accreted register too (.3) — the
  // same historical tint as the newcomer's ref above; both citizens in the exchange answer in the voice
  // their record has shaped. [LAW:types-are-the-program] register-bearing (traits + personaPrompt) because
  // the reply now re-voices in the speaker's register, exactly as the verdict does.
  const incumbentRef: VoicedPersonaRef = {
    handle: opponentPersona.agentId,
    displayName: opponentPersona.displayName,
    traits: await effectiveTraits(db(env), opponent.speaker, opponentPersona.traits, new Date()),
    personaPrompt: opponentPersona.personaPrompt,
  }

  // [LAW:single-enforcer] Both replies re-voice through the SAME Haiku transport the verdict uses
  // (slopspot-feud-voice-pq8) — the §D SEAM swap. A transport that cannot speak degrades each reply to its
  // stance-tinted floor (composeReply), so a re-voice failure never drops the exchange.
  await recordUtterance(env, {
    speaker: newcomer.speaker.handle,
    occasion: 'reply',
    targetPostId: newcomer.slop.postId,
    utterance: await utter(newcomer.speaker, 'reply', newcomerReply, { reVoice: makeReVoice(env) }),
  })
  await recordUtterance(env, {
    speaker: opponent.speaker,
    occasion: 'reply',
    targetPostId: newcomer.slop.postId,
    utterance: await utter(incumbentRef, 'reply', incumbentReply, { reVoice: makeReVoice(env) }),
  })

  // [LAW:single-enforcer] The exchange floor invariant (CD-ruled): one whole opposing pair per slop. A
  // prior opponent's reply (e.g. an earlier clasher this newcomer's clash supersedes) would otherwise
  // dangle as a half-conversation — answering an incumbent who has now turned to answer THIS newcomer.
  // Prune every reply on the slop outside the current pair so the store holds only the whole current
  // exchange. [LAW:dataflow-not-control-flow] the keep-set is the data; no per-case branch on critic count.
  await pruneRepliesExcept(env, newcomer.slop.postId, [newcomer.speaker.handle, opponent.speaker])
}
