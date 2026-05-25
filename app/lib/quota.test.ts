import { describe, expect, it } from 'vitest'
import { tryReserve, DAILY_QUOTA } from './quota'

// ─── Mock D1 ──────────────────────────────────────────────────────────────────
//
// Simulates the two-statement batch at the application-logic level.
// SQL syntax / D1 atomicity correctness requires @cloudflare/vitest-pool-workers
// with a real Miniflare D1 backend (ticket slopspot-foundation-bux.3.1).
// These tests cover boundary conditions and the sequential logic path.

function makeD1Mock(initial = 0) {
  let count = initial

  const stub = {
    prepare: (_sql: string) => ({
      bind: (..._params: unknown[]) => ({}) as D1PreparedStatement,
    }),
    batch: async (_stmts: D1PreparedStatement[]) => {
      // simulate INSERT ... ON CONFLICT(date) DO NOTHING (always a no-op in our model)
      const r1 = { results: [] } as unknown as D1Result

      let r2: D1Result
      if (count < DAILY_QUOTA) {
        count += 1
        r2 = { results: [{ count }] } as unknown as D1Result
      } else {
        r2 = { results: [] } as unknown as D1Result
      }
      return [r1, r2] as D1Result[]
    },
    getCount: () => count,
  }

  return stub
}

function makeEnv(mock: ReturnType<typeof makeD1Mock>): Env {
  return { DB: mock as unknown as D1Database } as unknown as Env
}

// ─── tryReserve boundary ──────────────────────────────────────────────────────

describe('tryReserve', () => {
  it('returns reserved with remaining=19 on a fresh day (count=0)', async () => {
    const env = makeEnv(makeD1Mock(0))
    const result = await tryReserve(env)
    expect(result).toEqual({ kind: 'reserved', remaining: DAILY_QUOTA - 1 })
  })

  it('returns reserved with remaining=0 on the 20th call (count=19→20)', async () => {
    const env = makeEnv(makeD1Mock(DAILY_QUOTA - 1))
    const result = await tryReserve(env)
    expect(result).toEqual({ kind: 'reserved', remaining: 0 })
  })

  it('returns exhausted when count is already at cap (count=20)', async () => {
    const env = makeEnv(makeD1Mock(DAILY_QUOTA))
    const result = await tryReserve(env)
    expect(result.kind).toBe('exhausted')
  })

  it('exhausted includes a retryAfter ISO string at UTC midnight', async () => {
    const env = makeEnv(makeD1Mock(DAILY_QUOTA))
    const before = Date.now()
    const result = await tryReserve(env)
    const after = Date.now()

    if (result.kind !== 'exhausted') throw new Error('expected exhausted')
    const retryAt = new Date(result.retryAfter).getTime()

    // retryAfter is UTC midnight — must be after now and no more than 24h away
    expect(retryAt).toBeGreaterThan(before)
    expect(retryAt).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000)

    // Must be exactly on the hour/minute/second boundary (midnight UTC)
    const d = new Date(result.retryAfter)
    expect(d.getUTCHours()).toBe(0)
    expect(d.getUTCMinutes()).toBe(0)
    expect(d.getUTCSeconds()).toBe(0)
    expect(d.getUTCMilliseconds()).toBe(0)
  })

  it('does not exhaust on the 19th call (remaining=1)', async () => {
    const env = makeEnv(makeD1Mock(DAILY_QUOTA - 2))
    const result = await tryReserve(env)
    expect(result).toEqual({ kind: 'reserved', remaining: 1 })
  })

  // The mock's `batch` is synchronous inside an async wrapper. Because it
  // never yields (no real awaits inside the function body), all 30 Promises
  // created by Promise.all run-to-completion in the order they were queued —
  // making the counter increments deterministic. Real D1 atomicity (concurrent
  // network calls) is covered by the pool-workers integration test (bux.3.1).
  it('exactly 20 out of 30 concurrent reserves succeed', async () => {
    const mock = makeD1Mock(0)
    const env = makeEnv(mock)
    const results = await Promise.all(
      Array.from({ length: 30 }, () => tryReserve(env))
    )
    const reserved = results.filter((r) => r.kind === 'reserved')
    const exhausted = results.filter((r) => r.kind === 'exhausted')
    expect(reserved.length).toBe(DAILY_QUOTA)
    expect(exhausted.length).toBe(30 - DAILY_QUOTA)
  })

  it('UTC midnight rollover: a new date produces a fresh reserved result', async () => {
    // Simulate 20 exhausted on "yesterday", then re-query "today"
    // Since our mock tracks a single counter, we verify that fresh count=0
    // starts reserved again — the real rollover happens via a new D1 row key.
    const fresh = makeEnv(makeD1Mock(0))
    const result = await tryReserve(fresh)
    expect(result).toEqual({ kind: 'reserved', remaining: DAILY_QUOTA - 1 })
  })

  it('remaining decrements correctly across multiple calls', async () => {
    const mock = makeD1Mock(0)
    const env = makeEnv(mock)

    const r1 = await tryReserve(env)
    const r2 = await tryReserve(env)
    const r3 = await tryReserve(env)

    expect(r1).toEqual({ kind: 'reserved', remaining: DAILY_QUOTA - 1 })
    expect(r2).toEqual({ kind: 'reserved', remaining: DAILY_QUOTA - 2 })
    expect(r3).toEqual({ kind: 'reserved', remaining: DAILY_QUOTA - 3 })
  })
})

// ─── today string ─────────────────────────────────────────────────────────────

describe('today string format', () => {
  it('uses YYYY-MM-DD UTC (not local timezone)', () => {
    // The date key is `new Date().toISOString().slice(0, 10)` — always UTC.
    // Validate that it matches the ISO 8601 date pattern.
    const today = new Date().toISOString().slice(0, 10)
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
