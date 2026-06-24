// [LAW:behavior-not-structure] The Pulse event identity contract: a key must be UNIQUE within the
// stream so React never silently drops a colliding event (the bug this guards — two critics blessing
// the same slop at the same seeded ts once produced one key for both, and one vanished). Also pins
// the feast's ts-independence, which the live Hum poll's backoff depends on.

import { describe, expect, it } from "vitest"
import type { PulseEvent } from "~/db/pulse"
import { pulseEventKey } from "~/lib/pulse-key"

const ev = (e: Partial<PulseEvent> & { kind: PulseEvent["kind"] }) => e as unknown as PulseEvent

describe("pulseEventKey", () => {
  it("distinguishes two citizens blessing the SAME post at the SAME ts (the dropped-event bug)", () => {
    const a = ev({ kind: "blessed", postId: "p1", persona: "St. Vivian", ts: 1749400000000 })
    const b = ev({ kind: "blessed", postId: "p1", persona: "The Formalist", ts: 1749400000000 })
    expect(pulseEventKey(a)).not.toBe(pulseEventKey(b))
  })

  it("distinguishes a bless from a bury on the same post/voter/ts", () => {
    const blessed = ev({ kind: "blessed", postId: "p1", persona: "X", ts: 100 })
    const buried = ev({ kind: "buried", postId: "p1", persona: "X", ts: 100 })
    expect(pulseEventKey(blessed)).not.toBe(pulseEventKey(buried))
  })

  it("keys a feast on (postId, riteDay), ignoring its volatile nowMs ts", () => {
    const early = ev({ kind: "feast", postId: "p1", riteDay: "2026-06-24", ts: 1 })
    const late = ev({ kind: "feast", postId: "p1", riteDay: "2026-06-24", ts: 999999 })
    expect(pulseEventKey(early)).toBe(pulseEventKey(late))
  })

  it("keys a post-less birth by its ts", () => {
    expect(pulseEventKey(ev({ kind: "born", ts: 42 }))).toBe("born:42")
  })
})
