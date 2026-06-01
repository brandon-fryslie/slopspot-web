// [LAW:behavior-not-structure] Pins foundation.8's contract: the box's response is
// an OPEN discriminated union (slop | reply), with the reply arm declared-but-
// unimplemented. The real verifier is tsc -b (the exhaustive fold's `never` default
// would become reachable if an arm were dropped); these runtime assertions prove the
// two arms are constructible and that v1 builds only the slop arm through slopResponse.

import { describe, it, expect } from 'vitest'
import { slopResponse, wellVoiceLine, type WellResponse } from '~/lib/well-response'
import { PostId } from '~/lib/domain'

// An exhaustive fold over WellResponse. If the `reply` arm were removed from the
// union, `r` would narrow to the slop arm in the default and the `never` assignment
// would fail to compile — so this function existing-and-typechecking IS the proof
// that the channel is open. [LAW:dataflow-not-control-flow] the arm is selected by
// the response's own `kind`, never a flag.
function describeArm(r: WellResponse): string {
  switch (r.kind) {
    case 'slop':
      return `slop:${r.postId}`
    case 'reply':
      return `reply:${r.text}`
    default: {
      const _exhaustive: never = r
      return _exhaustive
    }
  }
}

describe('WellResponse — the open box contract', () => {
  it('slopResponse builds the v1 (Mark) arm', () => {
    const r = slopResponse(PostId('p1'))
    expect(r).toEqual({ kind: 'slop', postId: 'p1' })
    expect(describeArm(r)).toBe('slop:p1')
  })

  it('the reply arm is part of the type — reserved, not built', () => {
    // Constructing a reply is legal BY THE TYPE: the channel is open. The v1 server
    // never returns this; the assertion is that the arm is DECLARED so the talk-back
    // path (Acts IV–V) needs no contract change — it slots into the existing union.
    const reply: WellResponse = { kind: 'reply', text: 'Darling. You finally looked up.' }
    expect(describeArm(reply)).toBe('reply:Darling. You finally looked up.')
  })
})

describe("wellVoiceLine — failures speak in the well's voice", () => {
  // The box's failure display shows ONLY this line. On the one surface whose whole
  // job is the spell, leaking a status code, the JSON envelope, or a JS error string
  // shatters it — so assert the well-voice contract across every failure shape the
  // box can hit (HTTP statuses + the network/thrown null case).
  const failureShapes: Array<number | null> = [429, 503, 502, 500, 403, 400, null]

  it('never surfaces a status code, JSON envelope, or raw error string', () => {
    for (const status of failureShapes) {
      const line = wellVoiceLine(status)
      expect(line, `status=${status}`).not.toMatch(/\d/) // no digits → no status code
      expect(line, `status=${status}`).not.toMatch(/[{}]/) // no JSON envelope
      expect(line, `status=${status}`).not.toMatch(/Failed to fetch/i) // no fetch error
      expect(line.length).toBeGreaterThan(0)
    }
  })

  it('voices the daily cap (429) as a promise of return; every other failure is the quiet', () => {
    expect(wellVoiceLine(429)).toMatch(/fills again/i)
    expect(wellVoiceLine(503)).toBe('the well went quiet')
    expect(wellVoiceLine(500)).toBe('the well went quiet')
    expect(wellVoiceLine(null)).toBe('the well went quiet')
  })
})
