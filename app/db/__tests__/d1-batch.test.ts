// [LAW:verifiable-goals] SHAPE CONTRACT — the teeth on the cast that `d1StmtResult` owns.
//
// createPost / setVote / recordRemark guard the non-throwing partial-commit mode (the
// May-2026 orphan outage) by reading a batch statement result's `.success`. drizzle's
// batch return type does not expose that field — `d1StmtResult` casts to the real
// runtime `D1Result` shape to reach it. A cast bypasses the type checker, so if a
// drizzle upgrade renames/removes the field the defense would die SILENTLY (always-
// truthy `.success` → orphan-blindness with no alarm).
//
// This proves, against the live miniflare D1, that a successful statement's result —
// read THROUGH the helper — really exposes `.success` as a boolean `true`. A shape
// change trips RED here, at the one place the cast lives, instead of dead-ending the
// defense in the dark at eleven call sites.

import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { db } from '~/db/client'
import { votes } from '~/db/schema'
import { d1StmtResult } from '~/db/d1-batch'
import { seedPost } from './helpers'

describe('d1StmtResult (batch statement shape contract)', () => {
  it('reads .success as a boolean true from a successful batch statement', async () => {
    const postId = await seedPost(env, {})
    const database = db(env)
    const results = await database.batch([
      database.insert(votes).values({ postId, voterId: 'shape-x', value: 1, createdAt: new Date() }),
    ])
    const raw = d1StmtResult(results[0])
    expect(typeof raw.success).toBe('boolean')
    expect(raw.success).toBe(true)
  })
})
