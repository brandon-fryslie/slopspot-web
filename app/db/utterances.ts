// [LAW:single-enforcer] The read/write side of the `utterances` table — the first-class addressable
// record of what citizens say (slopspot-voice-w2v.1, design-docs/the-voice-layer.md). `recordUtterance`
// is the ONE writer (the spec's "persistence of the returned Utterance is the caller's single-enforcer
// write, done once"); `verdictsForPosts` is the batched read that surfaces verdict lines on the feed,
// RETIRING feed.ts's ad-hoc derivation from votes.reasoning — the utterance store is now the single
// source for the rendered line. [LAW:one-source-of-truth]

import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import { db, type DB } from '~/db/client'
import { personas, utterances, votes } from '~/db/schema'
import type { Occasion, Utterance } from '~/lib/voice'
import type { Verdict, VerdictDisposition } from '~/lib/domain'

// [LAW:dataflow-not-control-flow] How many co-present verdicts a single slop surfaces. ≥2 is the feud's
// visual germ (the-voice-layer.md): the Gremlin's burial and Vivian's blessing of the SAME slop, side
// by side. Capped so a heavily-judged slop's card stays bounded; the rest live in the record (the .5
// cast page reads them). One value, not a mode.
export const CO_PRESENCE_CAP = 3

// [LAW:types-are-the-program] The Utterance union → the two-arm column projection the utterances_shape
// CHECK demands: `spoke` carries text (and a null reason), `withheld` carries a reason (and null text).
// One place maps the domain union to columns, mirroring helpers.ts's statusColumns.
function utteranceColumns(u: Utterance) {
  return u.kind === 'spoke'
    ? { kind: 'spoke' as const, text: u.text, withheldReason: null }
    : { kind: 'withheld' as const, text: null, withheldReason: u.reason }
}

// [LAW:single-enforcer] The ONE writer of an utterance. Persists the returned Utterance once, keyed by
// (speaker, target, occasion) — a re-vote UPSERTS the latest verdict (the unique index enforces one
// current utterance per citizen/slop/occasion, matching the votes upsert model). The voice has already
// degraded any failure to Withheld{unavailable} upstream (speak() in voice.ts), so both arms persist:
// a chosen/forced silence is a REAL recorded row, not an absence. [LAW:no-silent-fallbacks]
export async function recordUtterance(
  env: Env,
  input: { speaker: string; occasion: Occasion; targetPostId: string | null; utterance: Utterance },
): Promise<void> {
  const cols = utteranceColumns(input.utterance)
  await db(env)
    .insert(utterances)
    .values({
      id: crypto.randomUUID(),
      speaker: input.speaker,
      occasion: input.occasion,
      targetPostId: input.targetPostId,
      createdAt: new Date(),
      ...cols,
    })
    .onConflictDoUpdate({
      target: [utterances.speaker, utterances.targetPostId, utterances.occasion],
      // [LAW:one-source-of-truth] The latest take replaces the prior one (id + the row's identity
      // stay; only the spoken/withheld content + time move). NOT a second row — one current utterance.
      set: { ...cols, createdAt: new Date() },
    })
}

// [LAW:types-are-the-program] The representative vote's sign IS the verdict's disposition — the gilt
// blessing vs the burial robe. Same CHECK-guaranteed stored shape (-1 | 1); a drifted value fails loud.
function toDisposition(raw: number, postId: string): VerdictDisposition {
  if (raw === 1) return 'blessed'
  if (raw === -1) return 'buried'
  throw new Error(`utterances: verdict vote value ${raw} for post ${postId} is outside the stored shape (-1 | 1)`)
}

// [LAW:single-enforcer] The batched phase-2 read of verdict lines for a set of visible posts — keyed by
// postIds (≤ a page), NEVER per-post (no N+1), so getFeedPage's phase-1 keyset SEEK is untouched.
// Replaces fetchVerdicts: the line + critic + disposition now come from the utterance record (text +
// the speaker's persona name) JOINed to the vote (the disposition the verdict narrates), instead of
// re-deriving from votes.reasoning.
//
// Returns up to CO_PRESENCE_CAP verdicts per post, newest first — the co-presence set. A spoke verdict
// by a named critic surfaces; a withheld verdict is recorded but renders no line (its absence is the
// occasion's silence-treatment, handled at the boundary by NOT selecting it here). The INNER JOINs make
// a verdict a real critic's judgment of a real vote: an utterance whose speaker is not a persona, or
// whose vote was retracted, has no line to show and falls out by construction.
export async function verdictsForPosts(
  database: DB,
  postIds: readonly string[],
): Promise<Map<string, Verdict[]>> {
  if (postIds.length === 0) return new Map()

  // [LAW:no-silent-fallbacks] The critic must be NAMED — a blank displayName is no byline, so the
  // verdict is excluded (the same gate fetchVerdicts applied), never rendered as `— `.
  const named = sql`trim(${personas.displayName}) <> ''`

  const ranked = database
    .select({
      postId: utterances.targetPostId,
      text: utterances.text,
      critic: personas.displayName,
      value: votes.value,
      rank: sql<number>`row_number() over (
        partition by ${utterances.targetPostId}
        order by ${utterances.createdAt} desc, ${utterances.speaker} desc
      )`.as('verdict_rank'),
    })
    .from(utterances)
    .innerJoin(personas, eq(personas.agentId, utterances.speaker))
    .innerJoin(
      votes,
      and(eq(votes.postId, utterances.targetPostId), eq(votes.voterId, utterances.speaker)),
    )
    .where(
      and(
        eq(utterances.occasion, 'verdict'),
        eq(utterances.kind, 'spoke'),
        inArray(utterances.targetPostId, postIds),
        named,
      ),
    )
    .as('ranked_verdicts')

  const rows = await database
    .select({ postId: ranked.postId, text: ranked.text, critic: ranked.critic, value: ranked.value })
    .from(ranked)
    .where(lte(ranked.rank, CO_PRESENCE_CAP))
    // [LAW:one-source-of-truth] rank 1 is the NEWEST (the window orders created_at desc), so ASC rank
    // yields NEWEST-FIRST — the order RenderablePost.verdicts promises and .2's Feud Engine inherits.
    // (desc(rank) would render oldest-first, silently contradicting the contract.)
    .orderBy(asc(ranked.rank))

  const byPost = new Map<string, Verdict[]>()
  for (const r of rows) {
    // targetPostId is non-null here (the WHERE filters to verdict rows in `postIds`); text is non-null
    // by the kind='spoke' filter + the utterances_shape CHECK. Build the domain Verdict.
    const postId = r.postId!
    const verdict: Verdict = {
      text: r.text!.trim(),
      critic: r.critic.trim(),
      disposition: toDisposition(r.value, postId),
    }
    const list = byPost.get(postId)
    if (list === undefined) byPost.set(postId, [verdict])
    else list.push(verdict)
  }
  return byPost
}
