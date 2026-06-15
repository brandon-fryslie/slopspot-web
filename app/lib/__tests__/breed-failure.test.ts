// [LAW:behavior-not-structure] Pins the shared pause taxonomy contract: the type and
// status mapper are shared between fork and breed; each page owns its own voice copy.
// The real completeness verifier is `tsc -b` (the exhaustive fold's `never` default in
// each page's local pauseHeadline goes reachable if a reason is dropped). These
// assertions cover the shared module's contract only: reason taxonomy and status mapping.

import { describe, it, expect } from 'vitest'
import { BREED_PAUSE_REASONS, forkPause, type BreedPause } from '~/lib/breed-failure'

describe('forkPause — the fork/breed phase HTTP status selects a pause reason from data', () => {
  it('maps each known failure status to its specific, honest pause reason', () => {
    // [LAW:behavior-not-structure] The contract is the status→reason pairing, not the
    // table's shape. 429 is the budget cap; 502/503 separate "forge upstream failed" from
    // "could not read the ledger"; 422/404 are the provider rejecting the request shape.
    expect(forkPause(429)).toEqual({ reason: 'out-of-budget' })
    expect(forkPause(502)).toEqual({ reason: 'provider-unreachable' })
    expect(forkPause(503)).toEqual({ reason: 'budget-unavailable' })
    expect(forkPause(422)).toEqual({ reason: 'provider-rejected' })
    expect(forkPause(404)).toEqual({ reason: 'provider-rejected' })
  })

  it('maps every unlisted status to the quiet unknown', () => {
    // A 500, a 403, a malformed-body 400, a network 0 — none has a table entry, so all
    // read as unknown (the visitor hears the quiet line; the real status hits the console).
    for (const status of [500, 403, 400, 0, 418]) {
      expect(forkPause(status), `status=${status}`).toEqual({ reason: 'unknown' })
    }
  })
})

// Exhaustiveness of the BreedPause reason union is enforced by tsc -b via the `never`
// default in each page's local pauseHeadline. This list is DERIVED from the single-source
// reason tuple so it cannot drift: adding a reason there flows here, and the matching arm
// in those page functions is forced by the build. [LAW:one-source-of-truth]
export const ALL_PAUSE_REASONS: ReadonlyArray<BreedPause> = BREED_PAUSE_REASONS.map(
  (reason) => ({ reason }),
)
