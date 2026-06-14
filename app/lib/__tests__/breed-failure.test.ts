// [LAW:behavior-not-structure] Pins the shared pause taxonomy contract: the type and
// status mapper are shared between fork and breed; each page owns its own voice copy.
// The real completeness verifier is `tsc -b` (the exhaustive fold's `never` default in
// each page's local pauseHeadline goes reachable if a reason is dropped). These
// assertions cover the shared module's contract only: reason taxonomy and status mapping.

import { describe, it, expect } from 'vitest'
import { forkPause, type BreedPause } from '~/lib/breed-failure'

describe('forkPause — the fork/breed phase HTTP status selects a pause reason from data', () => {
  it('maps the daily-budget cap (429) to out-of-budget — the named "out of money" axis', () => {
    expect(forkPause(429)).toEqual({ reason: 'out-of-budget' })
  })

  it('maps every other failure status to the quiet unknown', () => {
    // A provider 502, a 500, a 403 — none is the budget cap, so all read as unknown
    // (the visitor hears the quiet line; the real status is logged to the console).
    for (const status of [500, 502, 503, 403, 400]) {
      expect(forkPause(status), `status=${status}`).toEqual({ reason: 'unknown' })
    }
  })
})

// Exhaustiveness of the BreedPause reason union is enforced by tsc -b via the `never`
// default in each page's local pauseHeadline. This list exists so a new reason added
// here without a matching arm in those functions breaks the build immediately.
export const ALL_PAUSE_REASONS: ReadonlyArray<BreedPause> = [
  { reason: 'muse-unreachable' },
  { reason: 'muse-empty' },
  { reason: 'out-of-budget' },
  { reason: 'unknown' },
]
