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
import { db, type DB } from '~/db/client'
import { posts, votes } from '~/db/schema'
import type { PostId, VoteIntent, VoteValue } from '~/lib/domain'

export type SetVoteInput = {
  postId: PostId
  voterId: string
  value: VoteIntent
}

// [LAW:types-are-the-program] setVote has two real outcomes — the vote applied,
// or the post does not exist. The "post not found" arm used to be encoded as a
// thrown FK-constraint error that the route then mis-mapped to 500. Lifting it
// into a discriminated return makes the route's HTTP mapping mechanical: 200
// on `ok`, 404 on `post_not_found`. Real I/O failures still throw — the route
// still 500s on those, which is the correct shape.
export type SetVoteResult =
  | { ok: true; score: number; value: VoteValue | null }
  | { ok: false; reason: 'post_not_found' }

// [LAW:dataflow-not-control-flow] Same shape every call: confirm the post
// exists, then write (or remove) the vote row, then read the new score. The
// discriminator on `value` decides which SQL statement runs; both arms
// terminate at the same "select the new score" step.
export async function setVote(
  input: SetVoteInput,
  ctx: { env: Env },
): Promise<SetVoteResult> {
  const { postId, voterId, value } = input
  const database = db(ctx.env)

  // [LAW:single-enforcer] The post-existence check is the writer's
  // responsibility; the route is HTTP-shape only. A pre-check is symmetric
  // across insert and delete (DELETE on a non-existent row is silently a
  // no-op, so an FK-catch on the insert arm wouldn't cover the retract
  // case). The TOCTOU race (post deleted between this check and the write)
  // surfaces as an FK violation — that's a legitimate 5xx, not a 404.
  const exists = await database
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1)
  if (exists.length === 0) {
    return { ok: false, reason: 'post_not_found' }
  }

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
    ok: true,
    score: await scoreFor(database, postId),
    value: value === 0 ? null : value,
  }
}

// [LAW:one-source-of-truth] Same SUM-with-coalesce shape feed.ts uses for the
// list view, scoped to one post. Takes the already-constructed DB instance so
// a single request initializes Drizzle once — setVote calls it on its own
// database; external callers pass theirs in.
export async function scoreFor(database: DB, postId: PostId): Promise<number> {
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
