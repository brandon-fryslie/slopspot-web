// [LAW:single-enforcer] One module, one operation: tryReserveFoundSubmission
// atomically increments today's counter for a given voter and returns
// reserved-or-exhausted. Both /api/found and /submit call this before
// createPost — never a separate check-then-increment, never an inline count
// query scattered through routes.
//
// [LAW:dataflow-not-control-flow] Both SQL statements always run. The INSERT
// materializes today's row; the UPDATE's WHERE-guard and RETURNING are the
// discriminator. Empty RETURNING → exhausted. Row in RETURNING → reserved.
// Same code path every call regardless of whether the row existed yet.
//
// [LAW:single-enforcer] exception: env.DB is used directly (not via db() in
// app/db/client.ts) because D1 batch atomicity is expressed at the D1 API
// layer — the same exception app/lib/quota.ts takes for challenge_quota.
//
// Sibling of app/lib/quota.ts: that module enforces a global daily ceiling
// on generated posts; this one enforces a per-voter daily ceiling on
// outbound-link submissions. The (voter_id, date) composite PK keeps each
// voter on their own counter.

// 10/day per voter. Calibration knob: tighten in prod if drive-by abuse
// shows up; loosen in dev for manual smoke testing. Held as a constant
// rather than an env var because the value is part of the contract — the
// 429 message reveals the cap, and the test asserts on it.
export const FOUND_DAILY_CAP = 10

export type ReserveResult =
  | { kind: 'reserved'; remaining: number }
  | { kind: 'exhausted'; retryAfter: string }

// [LAW:errors] Slot is consumed before createPost. If createPost fails, the
// slot is gone for the day — same trade-off challenge_quota accepts to avoid
// TOCTOU overshoot on a hard cap. The post-failure case is rare and the cost
// is one missing slot, not double-spending.
export async function tryReserveFoundSubmission(
  env: Env,
  voterId: string,
): Promise<ReserveResult> {
  const today = new Date().toISOString().slice(0, 10)
  const [, updateResult] = await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO found_submission_quota (voter_id, date, count) VALUES (?1, ?2, 0) ON CONFLICT(voter_id, date) DO NOTHING',
    ).bind(voterId, today),
    env.DB.prepare(
      'UPDATE found_submission_quota SET count = count + 1 WHERE voter_id = ?1 AND date = ?2 AND count < ?3 RETURNING count',
    ).bind(voterId, today, FOUND_DAILY_CAP),
  ])
  const rows = updateResult.results as { count: number }[]
  if (rows.length === 0) {
    // [LAW:dataflow-not-control-flow] retryAfter is computed from the data,
    // not a branch on the cap value: the next midnight UTC is when the new
    // (voter, date) row will be unblocked. Same shape as challenge_quota.
    const retryAt = new Date()
    retryAt.setUTCHours(24, 0, 0, 0)
    return { kind: 'exhausted', retryAfter: retryAt.toISOString() }
  }
  return { kind: 'reserved', remaining: FOUND_DAILY_CAP - rows[0].count }
}
