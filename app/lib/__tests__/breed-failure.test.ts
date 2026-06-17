// [LAW:behavior-not-structure] Pins the shared pause taxonomy contract: the cause→reason
// mapper is shared between fork and breed; each page owns its own voice copy. The real
// completeness verifier is `tsc -b` (the exhaustive fold's `never` default in each page's
// local pauseHeadline goes reachable if a reason is dropped; `Record<ForkErrorCause, …>`
// makes a missing cause a compile error). These assertions cover the shared module's
// behavior: each unambiguous server CAUSE selects its one honest pause reason.

import { describe, it, expect } from 'vitest'
import { BREED_PAUSE_REASONS, forkPause, type BreedPause } from '~/lib/breed-failure'
import { FORK_ERROR_CAUSES, type ForkErrorCause } from '~/lib/fork-error'

describe('forkPause — a fork/breed failure CAUSE selects a pause reason from data', () => {
  // [LAW:behavior-not-structure] The contract is the cause→reason pairing. The two 502 causes
  // (provider-upstream vs internal) select DIFFERENT reasons — the whole point of the split:
  // "the forge hit a snag; try again" is honest for an upstream failure, a LIE for a server bug.
  const cases: ReadonlyArray<readonly [ForkErrorCause, BreedPause['reason']]> = [
    ['budget-exhausted', 'out-of-budget'],
    ['budget-unavailable', 'budget-unavailable'],
    ['provider-unavailable', 'provider-rejected'],
    ['invalid-params', 'provider-rejected'],
    ['provider-upstream', 'provider-unreachable'],
    ['internal', 'internal-error'],
    ['parent-not-found', 'unknown'],
    ['provider-not-registered', 'unknown'],
  ]

  it.each(cases)('maps cause %s to the %s pause reason', (cause, reason) => {
    expect(forkPause(cause)).toEqual({ reason })
  })

  it('covers every cause in the closed set — one behavior per cause, no gaps', () => {
    // [LAW:verifiable-goals] The table above must enumerate the WHOLE cause union; a new cause
    // added to FORK_ERROR_CAUSES without a row here fails this, before it can default to unknown.
    expect(cases.map(([cause]) => cause).sort()).toEqual([...FORK_ERROR_CAUSES].sort())
  })

  it('maps a null cause (no usable server signal) to the quiet unknown', () => {
    // [LAW:no-silent-failure] A true network failure / a response with no known cause yields
    // null — the honest quiet line, never a guessed reason.
    expect(forkPause(null)).toEqual({ reason: 'unknown' })
  })
})

// Exhaustiveness of the BreedPause reason union is enforced by tsc -b via the `never`
// default in each page's local pauseHeadline. This list is DERIVED from the single-source
// reason tuple so it cannot drift: adding a reason there flows here, and the matching arm
// in those page functions is forced by the build. [LAW:one-source-of-truth]
export const ALL_PAUSE_REASONS: ReadonlyArray<BreedPause> = BREED_PAUSE_REASONS.map(
  (reason) => ({ reason }),
)
