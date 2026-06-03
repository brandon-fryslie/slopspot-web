// [LAW:behavior-not-structure] Pins the breeding room's failure contract: a breed
// that cannot complete is shown to the visitor as an honest pause in the city's voice
// — NEVER the raw `rewrite failed: 502 {…}` / `fork failed: 429 {…}` string the fork
// page leaked before this fix (the prod breed bug, slopspot-breeding-3xe.1). The real
// verifier for completeness is `tsc -b` (the exhaustive fold's `never` default goes
// reachable if a reason is dropped); these runtime assertions prove every reason has a
// voice line and that none of those lines leaks a status code or JSON envelope.

import { describe, it, expect } from 'vitest'
import { breedPauseHeadline, forkPause, type BreedPause } from '~/lib/breed-failure'

// Every reason the breeding room can pause for. Listed explicitly (not derived) so a
// new reason added to the union without a line added here is caught: the sweep below
// would need its entry, and breedPauseHeadline's `never` default would already have
// failed `tsc -b`. [LAW:dataflow-not-control-flow] the test iterates DATA, not cases.
const ALL_REASONS: ReadonlyArray<BreedPause> = [
  { reason: 'muse-unreachable' },
  { reason: 'muse-empty' },
  { reason: 'out-of-budget' },
  { reason: 'unknown' },
]

describe('breedPauseHeadline — breed failures speak in the breeding room\'s voice', () => {
  it('never surfaces a status code, JSON envelope, or raw error string', () => {
    // This is the breed bug's regression guard: the visitor used to see
    // `rewrite failed: 502 {"error":"upstream error","status":401,…}`. Assert the
    // honest copy leaks none of that shape, for every reason.
    for (const pause of ALL_REASONS) {
      const line = breedPauseHeadline(pause)
      expect(line, pause.reason).not.toMatch(/\d/) // no digits → no status code
      expect(line, pause.reason).not.toMatch(/[{}]/) // no JSON envelope
      expect(line, pause.reason).not.toMatch(/failed/i) // no "rewrite failed" / "fork failed"
      expect(line, pause.reason).not.toMatch(/upstream|x-api-key|status/i) // no upstream wire detail
      expect(line.length).toBeGreaterThan(0)
    }
  })

  it('every line names the pause so the visitor knows breeding stopped (not silently dropped)', () => {
    // [LAW:no-silent-fallbacks] the pause is LOUD to the human — each line says so.
    for (const pause of ALL_REASONS) {
      expect(breedPauseHeadline(pause), pause.reason).toMatch(/paused/i)
    }
  })

  it('voices the muse failures and the budget cap distinctly', () => {
    expect(breedPauseHeadline({ reason: 'muse-unreachable' })).toMatch(/quiet|spirit|wish/i)
    expect(breedPauseHeadline({ reason: 'muse-empty' })).toMatch(/empty/i)
    expect(breedPauseHeadline({ reason: 'out-of-budget' })).toMatch(/morning|tonight|budget/i)
  })
})

describe('forkPause — the fork phase status selects a pause reason from data', () => {
  it('maps the daily-budget cap (429) to out-of-budget — the named "out of money" axis', () => {
    expect(forkPause(429)).toEqual({ reason: 'out-of-budget' })
  })

  it('maps every other fork failure status to the quiet unknown', () => {
    // A provider 502, a 500, a 403 — none is the budget cap, so all read as unknown
    // (the visitor hears the quiet line; the real status is logged to the console).
    for (const status of [500, 502, 503, 403, 400]) {
      expect(forkPause(status), `status=${status}`).toEqual({ reason: 'unknown' })
    }
  })
})
