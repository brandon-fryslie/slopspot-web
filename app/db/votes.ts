// [LAW:single-enforcer] The one place a vote row is written, updated, or
// removed. Every writer that mutates the votes table — the /api/posts/:id/vote
// route, future bulk reconciliation, future agent-driven voting — funnels
// through `setVote`. Score recomputation lives here too so that a caller never
// has to know which subset of votes to sum: pass a postId, get the new score.
//
// [LAW:one-source-of-truth][LAW:caches-are-derived] Score = SUM(votes.value). setVote
// MATERIALIZES it into posts.score in the SAME batch as the vote it applies, by RECOMPUTING
// from votes (never an increment — recompute-from-source is correct under any partial-commit
// interleaving; an increment would be catastrophic). The votes table stays authoritative;
// posts.score is a regenerable cache (the 0028 backfill is its definition + self-heal). feed.ts
// READS posts.score instead of re-summing per request — that removed the dominant hot-path CPU
// cost (the 2026-06-04 outage). The cache is correct in every interleaving because score is a
// total function of the committed votes; see the success-check asymmetry below.
//
// [LAW:types-are-the-program] `VoteIntent` is the wire shape (-1 | 0 | 1);
// `VoteValue` is the stored shape (-1 | 1). The 0 → DELETE translation happens
// here at the storage boundary, so the votes_value_shape CHECK can never be
// violated: a 0 has no SQL representation. The switch is exhaustive on a closed
// union — adding a sentinel to VoteIntent stops compilation here until handled.

import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, type DB } from '~/db/client'
import { posts, votes } from '~/db/schema'
import { emit } from '~/observability/metrics'
import type { PostId, VoteIntent, VoteValue } from '~/lib/domain'

export type SetVoteInput = {
  postId: PostId
  voterId: string
  value: VoteIntent
  // [LAW:one-source-of-truth] reasoning lives with the vote row. Absent for
  // human/anonymous votes; present for homelab agent votes after z.ai judgment.
  reasoning?: string
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
  const { postId, voterId, value, reasoning } = input
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

  // [LAW:dataflow-not-control-flow] The vote write is one statement whose SHAPE the `value`
  // discriminator picks (delete on retract, upsert otherwise) — not two code paths with two
  // score writes. Drizzle's onConflictDoUpdate emits INSERT ... ON CONFLICT DO UPDATE; the
  // (post_id, voter_id) PK enforces one vote per voter, no read-then-write.
  const voteStmt =
    value === 0
      ? database.delete(votes).where(and(eq(votes.postId, postId), eq(votes.voterId, voterId)))
      : database
          .insert(votes)
          .values({ postId, voterId, value, createdAt: new Date(), reasoning: reasoning ?? null })
          .onConflictDoUpdate({
            target: [votes.postId, votes.voterId],
            set: { value, createdAt: new Date(), reasoning: reasoning ?? null },
          })

  // [LAW:caches-are-derived] The score materialization recomputes from votes (subquery), in the
  // SAME batch, AFTER the vote write. MEASURED (app/db/__tests__/d1-batch-atomicity.test.ts): a
  // later statement's subquery SEES an earlier statement's effect within one D1 batch, so this
  // UPDATE includes the just-written vote. Recompute-not-increment means the column equals
  // SUM(committed votes) regardless of which statements committed.
  const scoreUpdate = database
    .update(posts)
    .set({ score: sql`COALESCE((SELECT SUM(${votes.value}) FROM ${votes} WHERE ${votes.postId} = ${postId}), 0)` })
    .where(eq(posts.id, postId))

  const results = await database.batch([voteStmt, scoreUpdate])

  // [LAW:no-silent-fallbacks] D1 batch is not transactional for the NON-THROWING failure mode:
  // drizzle's mapRunResult never checks D1Result.success, so a per-statement failure resolves
  // silently (the orphan incident, May 2026). Cast to the raw shape and split the two statements
  // by their DISTINCT failure MEANINGS — the asymmetry is the whole point:
  const voteRaw = results[0] as unknown as { success: boolean; error?: string }
  const scoreRaw = results[1] as unknown as { success: boolean; error?: string }

  // (1) The VOTE statement failing means the vote did NOT commit. Returning ok:true with a
  // recomputed score would tell the client "recorded" when nothing was. Fail loud → the route
  // 500s, the client retries. NEVER a false success.
  if (!voteRaw.success) {
    throw new Error(`setVote: vote write failed for post ${postId}: ${voteRaw.error ?? 'unknown'}`)
  }

  // (2) The SCORE statement failing is the opposite case: the vote DID commit (client intent
  // honored), only the derived cache column is momentarily stale. Swallow loudly — drift metric +
  // error log — and self-heal: the next vote to this post recomputes it, and the backfill is the
  // global recovery. Returning ok with the freshly-recomputed score (below) is honest: the vote
  // is real, and the client sees the true count even though the column lagged.
  if (!scoreRaw.success) {
    emit('slopspot.score.drift', { post_id: postId }, 1)
    console.error(
      `setVote: posts.score materialization failed for post ${postId} (vote committed, cache stale): ` +
        `${scoreRaw.error ?? 'unknown'} — self-heals on next vote / backfill`,
    )
  }

  // The new score: read the materialized column on the happy path (a PK lookup, cheaper than a
  // SUM); recompute from votes only on the rare cache-stale path so the returned number is honest.
  const score = scoreRaw.success
    ? (await database.select({ score: posts.score }).from(posts).where(eq(posts.id, postId)))[0]!.score
    : await scoreFor(database, postId)

  return { ok: true, score, value: value === 0 ? null : value }
}

export type VoterStat = {
  voterId: string
  voteCount: number
  upvotes: number
  downvotes: number
}

// Per-voter aggregate counts for the admin dashboard. Returns only rows with
// at least one vote — personas with no votes are absent from the result.
export async function voterStats(env: Env, voterIds: string[]): Promise<VoterStat[]> {
  if (voterIds.length === 0) return []
  const rows = await db(env)
    .select({
      voterId: votes.voterId,
      voteCount: sql<number>`count(*)`,
      upvotes: sql<number>`sum(case when ${votes.value} = 1 then 1 else 0 end)`,
      downvotes: sql<number>`sum(case when ${votes.value} = -1 then 1 else 0 end)`,
    })
    .from(votes)
    .where(inArray(votes.voterId, voterIds))
    .groupBy(votes.voterId)
  return rows.map((r) => ({
    voterId: r.voterId,
    voteCount: r.voteCount,
    upvotes: r.upvotes,
    downvotes: r.downvotes,
  }))
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

export type RecentVote = {
  postId: string
  value: VoteValue
  reasoning: string | null
  createdAt: Date
}

// [LAW:single-enforcer] The one read path for per-voter recent votes — a
// critic's recent verdicts on the public Cast citizen page (via the citizen
// ledger). Returns the most-recent `limit` votes cast by `voterId`, newest first.
export async function recentVotesForVoter(
  env: Env,
  voterId: string,
  limit: number,
): Promise<RecentVote[]> {
  const rows = await db(env)
    .select({
      postId: votes.postId,
      value: votes.value,
      reasoning: votes.reasoning,
      createdAt: votes.createdAt,
    })
    .from(votes)
    .where(eq(votes.voterId, voterId))
    .orderBy(desc(votes.createdAt))
    .limit(limit)
  return rows.map((r) => ({
    postId: r.postId,
    value: r.value as VoteValue,
    reasoning: r.reasoning,
    createdAt: r.createdAt,
  }))
}
