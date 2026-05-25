// [LAW:single-enforcer] The one place a vote row is written, updated, or
// removed. Every writer that mutates the votes table — the /api/posts/:id/vote
// route, future bulk reconciliation, future agent-driven voting — funnels
// through `setVote`. Score recomputation lives here too so that a caller never
// has to know which subset of votes to sum: pass a postId, get the new score.
//
// [LAW:one-source-of-truth] Score is `SUM(votes.value)` per post, computed here
// at write time AND in feed.ts at read time. Same SQL shape (sum + coalesce to
// zero); never a denormalized column on posts that two writers could disagree
// about.
//
// [LAW:types-are-the-program] `VoteIntent` is the wire shape (-1 | 0 | 1);
// `VoteValue` is the stored shape (-1 | 1). The 0 → DELETE translation happens
// here at the storage boundary, so the votes_value_shape CHECK can never be
// violated: a 0 has no SQL representation. The switch is exhaustive on a closed
// union — adding a sentinel to VoteIntent stops compilation here until handled.

import { and, eq, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { votes } from '~/db/schema'
import type { PostId, VoteIntent, VoteValue } from '~/lib/domain'

export type SetVoteInput = {
  postId: PostId
  voterId: string
  value: VoteIntent
}

// [LAW:dataflow-not-control-flow] Same shape every call: write (or remove) the
// vote row, then read the new score. The discriminator on `value` decides which
// SQL statement runs; both arms terminate at the same "select the new score"
// step. The "skip the write" anti-pattern would be an if that returns early —
// here every call to setVote mutates the votes table and returns the new score.
export async function setVote(
  input: SetVoteInput,
  ctx: { env: Env },
): Promise<{ score: number; value: VoteValue | null }> {
  const { postId, voterId, value } = input
  const database = db(ctx.env)

  if (value === 0) {
    await database
      .delete(votes)
      .where(and(eq(votes.postId, postId), eq(votes.voterId, voterId)))
  } else {
    // Drizzle's onConflictDoUpdate emits SQLite's INSERT ... ON CONFLICT DO UPDATE.
    // The (post_id, voter_id) PK is the conflict target; the row's value and
    // created_at advance to the latest write. One vote per voter is enforced by
    // the PK, not by a read-then-write here.
    await database
      .insert(votes)
      .values({
        postId,
        voterId,
        value,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [votes.postId, votes.voterId],
        set: { value, createdAt: new Date() },
      })
  }

  return {
    score: await scoreFor(postId, ctx),
    value: value === 0 ? null : value,
  }
}

// [LAW:one-source-of-truth] Same SUM-with-coalesce shape feed.ts uses for the
// list view, scoped to one post. Extracted so the route can return the post's
// score after a write without re-deriving the aggregate.
export async function scoreFor(
  postId: PostId,
  ctx: { env: Env },
): Promise<number> {
  const database = db(ctx.env)
  const rows = await database
    .select({
      score: sql<number>`coalesce(sum(${votes.value}), 0)`,
    })
    .from(votes)
    .where(eq(votes.postId, postId))
  // The aggregate query always returns exactly one row (with NULL → 0 via
  // coalesce). No defensive guard needed — single-row SELECT of a sum is total.
  return rows[0].score
}
