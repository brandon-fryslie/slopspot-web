// [LAW:single-enforcer] The city's CHORUS — the read that surfaces the cast's already-spoken voices on
// the homepage chrome. The masthead used to carry ONE hardcoded aside (PROPRIETOR.mastheadAside), so the
// whole page spoke in a single narrator's register — the "same-y quote" the director called out. This
// read routes that slot through the WHOLE ROSTER: the most-recently-active DISTINCT citizens, each in the
// voice they ALREADY spoke.
//
// [LAW:one-source-of-truth] The breadth is NOT minted here — it lives in the utterances store, authored at
// write time by the genome-driven re-voice (lib/voice's buildReVoicePrompt projects each citizen's
// traitBias). A React render cannot await the async LLM-backed utter(); the law-aligned move — the same
// one the card's verdicts, the Pulse's births, and the grace pull already make — is to READ the persisted
// lines, never re-voice at render. This module is a projection of rows, not a second voice path.
//
// [LAW:dataflow-not-control-flow] "Weighted by who's at work" is not a separate "who's online" query: a
// citizen judging right NOW writes both a vote (the Pulse reads it) and a verdict utterance (this reads
// it), so RECENCY of utterances IS the at-work signal — the Pulse read a third way (cast-at-work reads it
// a second). Ordering recent SPOKEN lines by DISTINCT speaker yields the citizens awake now, each once.

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { type DB } from '~/db/client'
import { personas, utterances } from '~/db/schema'
import { PostId } from '~/lib/domain'

// [LAW:types-are-the-program] One murmur in the chorus: the citizen's name (the byline), the line they
// spoke (ready to render — never empty, the kind='spoke' filter + the utterances_shape CHECK guarantee
// it), and the slop it was about (so the murmur links to /p/:id, the way an overheard remark points at
// the thing it judged). targetPostId is non-null for every occasion the chorus draws from.
export type ChorusLine = {
  readonly speaker: string
  readonly displayName: string
  readonly text: string
  readonly postId: PostId
}

// [LAW:dataflow-not-control-flow] The occasions whose SPEAKER is a varied citizen — the verdict and reply
// are LLM-re-voiced in the speaker's register (the genome's divergence made audible), and grace is the
// choosing citizen's own third-person line. `birth` is DELIBERATELY excluded: every birth line is the
// Proprietor's one voice, so it would dilute the chorus back toward the single narrator this read exists
// to break. The set is the value that drives breadth, not a branch.
const CHORUS_OCCASIONS = ['verdict', 'reply', 'grace'] as const

// [LAW:single-enforcer] The chorus read. One spoken line per DISTINCT speaker (row_number over the
// speaker, newest kept — the same window pattern verdictsForPosts uses, so the two reads cannot drift),
// the citizens ordered most-recent-first and capped. The cap BOUNDS the slot; it never PADS it — fewer
// distinct speakers yield a shorter chorus (the CD's guardrail: the chorus shows what's real, the
// Proprietor floor speaks only at zero). The INNER JOIN to personas makes every murmur a NAMED resident's
// real line; an utterance whose speaker is not a seeded persona, or whose name is blank, has no byline and
// falls out by construction — never rendered as `— `.
export async function getChorus(database: DB, limit = 3): Promise<ChorusLine[]> {
  const named = sql`trim(${personas.displayName}) <> ''`

  const ranked = database
    .select({
      speaker: utterances.speaker,
      displayName: personas.displayName,
      text: utterances.text,
      postId: utterances.targetPostId,
      createdAt: utterances.createdAt,
      // [LAW:one-source-of-truth] Rank 1 is each speaker's NEWEST spoken line — partition by speaker, the
      // window ordered created_at desc (speaker desc breaks ties deterministically, matching the store's
      // other windows). Keeping rank 1 collapses a chatty critic's many lines to its latest one, so the
      // chorus is BREADTH (distinct beings), never one citizen repeated.
      rank: sql<number>`row_number() over (
        partition by ${utterances.speaker}
        order by ${utterances.createdAt} desc, ${utterances.speaker} desc
      )`.as('chorus_rank'),
    })
    .from(utterances)
    .innerJoin(personas, eq(personas.agentId, utterances.speaker))
    .where(
      and(
        inArray(utterances.occasion, [...CHORUS_OCCASIONS]),
        eq(utterances.kind, 'spoke'),
        named,
      ),
    )
    .as('ranked_chorus')

  const rows = await database
    .select({
      speaker: ranked.speaker,
      displayName: ranked.displayName,
      text: ranked.text,
      postId: ranked.postId,
    })
    .from(ranked)
    .where(eq(ranked.rank, 1))
    // Most-recently-active distinct citizens first — the city awake now, each once.
    .orderBy(desc(ranked.createdAt), asc(ranked.speaker))
    .limit(limit)

  // [LAW:no-silent-failure] text is non-null by the kind='spoke' filter + the utterances_shape CHECK, and
  // targetPostId is non-null for every CHORUS_OCCASION (verdict/reply/grace all carry a target). A null in
  // either is a storage-integrity violation at this boundary — fail loud rather than render a bylined blank
  // or an unlinkable murmur, the same discipline spokenLinesForPosts / graceLinesForCity hold.
  return rows.map((r) => {
    if (r.text === null) {
      throw new Error(`chorus: spoke utterance by ${r.speaker} has null text`)
    }
    if (r.postId === null) {
      throw new Error(`chorus: utterance by ${r.speaker} has null target_post_id`)
    }
    return {
      speaker: r.speaker,
      displayName: r.displayName.trim(),
      text: r.text.trim(),
      postId: PostId(r.postId),
    }
  })
}
