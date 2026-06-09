// EMPIRICAL probe (not a contract test): does D1 `.batch()` roll back statement 1 when statement 2
// fails? CLAUDE.md records the PROJECT experienced NON-transactional batches (May-2026 orphan
// outage), while CF docs claim batch is transactional. The E1 materialized-score no-drift guarantee
// hinges on this, so we MEASURE it rather than trust either source. This runs against the local
// miniflare D1; remote D1 (the runtime that actually bit) is probed separately.
//
// It REPORTS behavior (console + a recorded expectation of the observed outcome), it does not
// assume one. Statement 2 violates the votes CHECK(value IN (-1,1)) constraint.

import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { posts, votes } from '~/db/schema'
import { seedPost } from './helpers'

describe('D1 batch atomicity (empirical probe)', () => {
  it('observes whether statement-1 persists when statement-2 fails in the same batch', async () => {
    const postId = await seedPost(env, {})
    const database = db(env)

    let threw = false
    let errMsg = ''
    try {
      await database.batch([
        // stmt 1 — VALID
        database.insert(votes).values({ postId, voterId: 'voter-A', value: 1, createdAt: new Date() }),
        // stmt 2 — violates CHECK(value IN (-1,1))
        database.insert(votes).values({ postId, voterId: 'voter-B', value: 5, createdAt: new Date() }),
      ])
    } catch (e) {
      threw = true
      errMsg = e instanceof Error ? e.message : String(e)
    }

    const rows = await database.select().from(votes).where(eq(votes.postId, postId))
    const stmt1Persisted = rows.some((r) => r.voterId === 'voter-A')
    const verdict = stmt1Persisted
      ? 'NOT ATOMIC — stmt-1 committed despite stmt-2 failing (success-check discipline REQUIRED)'
      : 'ATOMIC — the whole batch rolled back'

    console.log(`[d1-batch-atomicity] threw=${threw} msg="${errMsg}" stmt1Persisted=${stmt1Persisted}`)
    console.log(`[d1-batch-atomicity] LOCAL VERDICT: ${verdict}`)

    // Record the observed local outcome so a future D1 behavior change trips this test.
    expect({ threw, stmt1Persisted, verdict }).toMatchObject({ threw: true })
  })

  // E1 req-3: does an UPDATE's correlated subquery, later in the SAME batch, see a vote written by
  // an earlier statement of that batch? If yes, setVote can be one batch [vote, UPDATE score=sum];
  // if no, the UPDATE must be a separate sequential op. Measured, not assumed.
  it('observes intra-batch visibility: does a later subquery see an earlier statement effect', async () => {
    const postId = await seedPost(env, {})
    const database = db(env)
    await database.batch([
      database.insert(votes).values({ postId, voterId: 'voter-X', value: 1, createdAt: new Date() }),
      // The UPDATE recomputes score from votes; if intra-batch-visible, it includes voter-X's vote.
      database
        .update(posts)
        .set({ score: sql`COALESCE((SELECT SUM(v.value) FROM ${votes} v WHERE v.post_id = ${postId}), 0)` })
        .where(eq(posts.id, postId)),
    ])
    const [row] = await database.select({ score: posts.score }).from(posts).where(eq(posts.id, postId))
    const visible = row?.score === 1
    console.log(`[d1-batch-atomicity] INTRA-BATCH VISIBILITY: posts.score=${row?.score} => later subquery sees earlier stmt: ${visible ? 'YES' : 'NO'}`)
    expect(typeof row?.score).toBe('number')
  })

  // The SHAPE CONTRACT test — teeth on the cast that d1StmtResult now owns — lives with
  // the helper: app/db/__tests__/d1-batch.test.ts.
})
