// [LAW:single-enforcer] One module, one operation: tryReserve atomically
// increments today's count and returns reserved-or-exhausted. Every path
// through the challenge gate calls this before createPost — never a separate
// check-then-increment.
//
// [LAW:dataflow-not-control-flow] Both SQL statements always run. The INSERT
// materializes today's row; the UPDATE's WHERE-guard and RETURNING are the
// discriminator. Empty RETURNING → exhausted. Row in RETURNING → reserved.
// No application-level branch on "does a row exist today."
//
// [LAW:single-enforcer] exception: env.DB is used directly (not via db() in
// app/db/client.ts) because D1 batch atomicity is expressed at the D1 API
// layer. The drizzle batch() method accepts ORM query builders, not raw SQL
// SQLWrapper objects; wrapping these two statements in drizzle would require
// executing them outside the atomic batch. The quota table is outside the app
// domain schema (posts/generations) and warrants this targeted exception.

const DAILY_QUOTA = 20

export type ReserveResult =
  | { kind: 'reserved'; remaining: number }
  | { kind: 'exhausted'; retryAfter: string }

// [LAW:errors] Slot is consumed before createPost. If createPost fails, the
// slot is gone for the day — documented as accepted cost of avoiding TOCTOU
// overshoot on the 20/day hard cap.
export async function tryReserve(env: Env): Promise<ReserveResult> {
  const today = new Date().toISOString().slice(0, 10)
  const [, updateResult] = await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO challenge_quota (date, count) VALUES (?1, 0) ON CONFLICT(date) DO NOTHING'
    ).bind(today),
    env.DB.prepare(
      'UPDATE challenge_quota SET count = count + 1 WHERE date = ?1 AND count < ?2 RETURNING count'
    ).bind(today, DAILY_QUOTA),
  ])
  const rows = updateResult.results as { count: number }[]
  if (rows.length === 0) {
    const retryAt = new Date()
    retryAt.setUTCHours(24, 0, 0, 0)
    return { kind: 'exhausted', retryAfter: retryAt.toISOString() }
  }
  return { kind: 'reserved', remaining: DAILY_QUOTA - rows[0].count }
}
