// [LAW:one-source-of-truth] The cache invariant as an executable assertion: after ANY sequence of
// setVote calls, posts.score == COALESCE(SUM(votes.value), 0) for every post. This is what makes
// posts.score a legitimate DERIVED cache rather than a second source that can drift.
//
// [LAW:verifiable-goals] WITH TEETH (req-2, same discipline as the hash property test's calibration
// meta-assertion): a second test deliberately corrupts a stored score and asserts the invariant
// check FAILS — proving the green is evidence of correctness, not absence of checking.

import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { posts } from '~/db/schema'
import { setVote } from '~/db/votes'
import { PostId } from '~/lib/domain'
import { seedPost } from './helpers'

// Every post's stored score vs its recomputed SUM(votes). Returns the mismatches so a failure names
// the offending rows.
async function scoreMismatches(): Promise<{ id: string; stored: number; computed: number }[]> {
  const rows = await db(env)
    .select({
      id: posts.id,
      stored: posts.score,
      computed: sql<number>`COALESCE((SELECT SUM(value) FROM votes WHERE votes.post_id = ${posts.id}), 0)`,
    })
    .from(posts)
  return rows.filter((r) => r.stored !== r.computed)
}

describe('posts.score materialization: the cache invariant', () => {
  it('posts.score == SUM(votes) after an arbitrary setVote sequence (insert / change / retract)', async () => {
    const p1 = await seedPost(env, {})
    const p2 = await seedPost(env, {})
    // A mix: two upvotes, a flip to downvote, a vote on another post, and a retract.
    await setVote({ postId: p1, voterId: 'voter-a', value: 1 }, { env })
    await setVote({ postId: p1, voterId: 'voter-b', value: 1 }, { env })
    await setVote({ postId: p1, voterId: 'voter-a', value: -1 }, { env }) // a: +1 -> -1
    await setVote({ postId: p2, voterId: 'voter-c', value: 1 }, { env })
    await setVote({ postId: p1, voterId: 'voter-b', value: 0 }, { env }) // b: retract

    // p1 = a(-1) = -1 ; p2 = c(+1) = +1 — and the stored column must match the recomputed sum.
    const result = await setVote({ postId: p1, voterId: 'voter-d', value: 1 }, { env }) // p1: -1 + 1 = 0
    expect(result).toMatchObject({ ok: true, score: 0 })

    expect(await scoreMismatches()).toEqual([])
  })

  it('the returned score equals the materialized column on the happy path', async () => {
    const p = await seedPost(env, {})
    const r1 = await setVote({ postId: p, voterId: 'x', value: 1 }, { env })
    expect(r1).toMatchObject({ ok: true, score: 1 })
    const [row] = await db(env).select({ score: posts.score }).from(posts).where(eq(posts.id, p))
    expect(row?.score).toBe(1)
  })

  // [LAW:verifiable-goals] TEETH: corrupt the cache and prove the invariant check catches it.
  it('CALIBRATION: the invariant check FAILS when a stored score is deliberately wrong', async () => {
    const p = await seedPost(env, {})
    await setVote({ postId: p, voterId: 'a', value: 1 }, { env }) // true score = 1
    // Deliberately write a wrong score directly (bypassing setVote) — simulating drift / a bad write.
    await db(env).update(posts).set({ score: 999 }).where(eq(posts.id, PostId(p)))

    const mismatches = await scoreMismatches()
    expect(mismatches.length).toBeGreaterThan(0)
    expect(mismatches.some((m) => m.id === p && m.stored === 999 && m.computed === 1)).toBe(true)
  })
})
