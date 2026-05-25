// [LAW:single-enforcer] One module owns the mapping from internal verification
// outcomes to HTTP responses. No code outside this module decides response shape.
// [LAW:one-source-of-truth] Callers log the full Outcome (gate names, entryIds);
// the HTTP body strips mechanism-identifying fields where caller-opacity applies.

export type Outcome =
  | { kind: 'generated';          postId: string }
  | { kind: 'token_invalid' }
  | { kind: 'token_expired' }
  | { kind: 'bank_entry_missing'; entryId: string }   // logged by caller; NOT in body
  | { kind: 'form_violation';     which: 'easy' | 'hard'; detail: string }
  | { kind: 'secret_gate_failed'; gate: string }       // logged by caller; NOT in body
  | { kind: 'quota_exhausted';    retryAfter: string } // ISO UTC midnight

function assertNever(x: never): never {
  throw new Error(`Unhandled outcome: ${JSON.stringify(x)}`)
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function outcomeToResponse(o: Outcome): Response {
  switch (o.kind) {
    case 'generated':
      return json(200, { postId: o.postId })
    case 'token_invalid':
      return json(401, {
        error: 'challengeId is invalid',
        hint: 'GET /api/challenge for a fresh one',
      })
    case 'token_expired':
      return json(401, {
        error: 'challengeId has expired (240s TTL)',
        hint: 'GET /api/challenge for a fresh one',
      })
    case 'bank_entry_missing':
      return json(503, { error: 'challenge bank temporarily unavailable, please retry' })
    case 'form_violation':
      return json(403, {
        error:
          o.which === 'easy'
            ? 'submission failed positional constraint'
            : 'submission failed creative constraint',
        detail: o.detail,
      })
    case 'secret_gate_failed':
      return json(403, { error: 'submission did not meet quality criteria' })
    case 'quota_exhausted':
      return json(429, { error: 'daily quota reached', retryAfter: o.retryAfter })
    default:
      return assertNever(o)
  }
}
