// [LAW:single-enforcer] Designated response-shape seam for the protein-shell
// gate flow. The old route (api.generate.ts) will be replaced by ticket .7;
// once wired, this is the only place that maps verification outcomes to HTTP.
// [LAW:one-source-of-truth] Callers log the full Outcome (gate names, entryIds);
// the HTTP body strips mechanism-identifying fields where caller-opacity applies.

import { assertNever } from '~/lib/assert-never'

export type Outcome =
  | { kind: 'generated';          postId: string }
  | { kind: 'token_invalid' }
  | { kind: 'token_expired' }
  | { kind: 'bank_entry_missing'; entryId: string }   // logged by caller; NOT in body
  | { kind: 'form_violation';     which: 'easy' | 'hard'; detail: string }
  | { kind: 'secret_gate_failed'; gate: string }       // logged by caller; NOT in body
  | { kind: 'quota_exhausted';    retryAfter: string } // ISO UTC midnight

function json(status: number, body: unknown): Response {
  return Response.json(body, { status })
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
