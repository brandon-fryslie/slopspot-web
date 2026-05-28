// [LAW:behavior-not-structure] These tests pin tryReserveFoundSubmission's
// *contract* — what shape it returns for what storage state. They are
// deliberately blind to the SQL details (INSERT-OR-IGNORE + UPDATE+RETURNING):
// a refactor that keeps the contract intact must not require editing these
// tests, and a refactor that drifts must fail them.
//
// [LAW:types-are-the-program] These tests run against real D1 (workers
// project) — the same shape app/db/__tests__/feed.test.ts uses. The atomic
// batch's correctness only matters if it round-trips through actual D1
// semantics, not a mock that would let a misbehavior slip through.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { FOUND_DAILY_CAP, tryReserveFoundSubmission } from '~/lib/found-quota'

describe('app/lib/found-quota.ts - tryReserveFoundSubmission', () => {
  it('reserves on the first call and reports remaining', async () => {
    const result = await tryReserveFoundSubmission(env, 'voter-a')
    expect(result.kind).toBe('reserved')
    if (result.kind === 'reserved') {
      expect(result.remaining).toBe(FOUND_DAILY_CAP - 1)
    }
  })

  it('decrements remaining on each reservation', async () => {
    const r1 = await tryReserveFoundSubmission(env, 'voter-b')
    const r2 = await tryReserveFoundSubmission(env, 'voter-b')
    const r3 = await tryReserveFoundSubmission(env, 'voter-b')
    expect(r1).toEqual({ kind: 'reserved', remaining: FOUND_DAILY_CAP - 1 })
    expect(r2).toEqual({ kind: 'reserved', remaining: FOUND_DAILY_CAP - 2 })
    expect(r3).toEqual({ kind: 'reserved', remaining: FOUND_DAILY_CAP - 3 })
  })

  it('returns exhausted on the (cap+1)th call', async () => {
    for (let i = 0; i < FOUND_DAILY_CAP; i++) {
      const r = await tryReserveFoundSubmission(env, 'voter-c')
      expect(r.kind).toBe('reserved')
    }
    const r = await tryReserveFoundSubmission(env, 'voter-c')
    expect(r.kind).toBe('exhausted')
    if (r.kind === 'exhausted') {
      // retryAfter must parse as a valid ISO date in the future.
      const retry = new Date(r.retryAfter)
      expect(Number.isNaN(retry.getTime())).toBe(false)
      expect(retry.getTime()).toBeGreaterThan(Date.now())
    }
  })

  it('keeps each voter on an independent counter', async () => {
    // voter-d exhausts; voter-e is unaffected.
    for (let i = 0; i < FOUND_DAILY_CAP; i++) {
      await tryReserveFoundSubmission(env, 'voter-d')
    }
    expect((await tryReserveFoundSubmission(env, 'voter-d')).kind).toBe('exhausted')
    const e = await tryReserveFoundSubmission(env, 'voter-e')
    expect(e.kind).toBe('reserved')
    if (e.kind === 'reserved') {
      expect(e.remaining).toBe(FOUND_DAILY_CAP - 1)
    }
  })
})
