// [LAW:behavior-not-structure] The PURE core of the live Hum poll, tested as contracts: the
// change-signature collapses a snapshot to "did anything move", the backoff schedule eases off
// when nothing does, and arrival selection surfaces only the firehose's GENUINE new output —
// never a Hot-rank shuffle of an old slop. Timers/fetch/DOM are the hook's job and not tested here.

import { describe, expect, it } from "vitest"
import type { FeedItem } from "~/lib/domain"
import type { PulseEvent } from "~/db/pulse"
import {
  ARRIVALS_CAP,
  HUM_BASE_DELAY_MS,
  HUM_MAX_DELAY_MS,
  humSignature,
  nextHumDelay,
  selectArrivals,
} from "~/lib/hum"

// A minimal FeedItem — selectArrivals reads only post.id and post.createdAt, so the fixture pins
// those two and casts the rest. The cast is the test boundary, not a production launder.
function item(id: string, createdAtMs: number): FeedItem {
  return { post: { id, createdAt: new Date(createdAtMs) }, score: 0, myVote: null } as unknown as FeedItem
}

const posted = (id: string, ts: number): PulseEvent =>
  ({ kind: "posted", ts, persona: "X", postId: id, title: "t" }) as unknown as PulseEvent

describe("humSignature", () => {
  it("is stable when nothing changed", () => {
    const snap = { items: [item("a", 100)], pulse: [posted("a", 100)], crownedPostId: "c1" }
    expect(humSignature(snap)).toBe(humSignature(snap))
  })

  it("changes when the newest slop changes", () => {
    const before = { items: [item("a", 100)], pulse: [], crownedPostId: null }
    const after = { items: [item("b", 200), item("a", 100)], pulse: [], crownedPostId: null }
    expect(humSignature(before)).not.toBe(humSignature(after))
  })

  it("changes when the crown changes", () => {
    const before = { items: [], pulse: [], crownedPostId: "c1" }
    const after = { items: [], pulse: [], crownedPostId: "c2" }
    expect(humSignature(before)).not.toBe(humSignature(after))
  })

  it("is stable across polls for a feast whose ts moves with the wall clock (no fake heartbeat)", () => {
    // A feast is stamped with the loader's nowMs; two polls a minute apart carry the SAME feast
    // with DIFFERENT ts. The signature must ignore that volatile ts (it keys on postId+riteDay).
    const feastAt = (ts: number): PulseEvent =>
      ({ kind: "feast", ts, persona: "Saint", postId: "p1", lens: "beauty", riteDay: "2026-06-24" }) as unknown as PulseEvent
    const poll1 = { items: [], pulse: [feastAt(1000)], crownedPostId: null }
    const poll2 = { items: [], pulse: [feastAt(61000)], crownedPostId: null }
    expect(humSignature(poll1)).toBe(humSignature(poll2))
  })
})

describe("nextHumDelay", () => {
  it("resets to base when the poll changed", () => {
    expect(nextHumDelay(HUM_MAX_DELAY_MS, true)).toBe(HUM_BASE_DELAY_MS)
  })

  it("grows geometrically when nothing changed", () => {
    const d1 = nextHumDelay(HUM_BASE_DELAY_MS, false)
    expect(d1).toBeGreaterThan(HUM_BASE_DELAY_MS)
    expect(nextHumDelay(d1, false)).toBeGreaterThan(d1)
  })

  it("never exceeds the cap", () => {
    expect(nextHumDelay(HUM_MAX_DELAY_MS, false)).toBe(HUM_MAX_DELAY_MS)
  })
})

describe("selectArrivals", () => {
  const known = new Set(["a", "b"])

  it("surfaces a genuinely new slop newer than the high-water mark", () => {
    const { arrivals, maxTs } = selectArrivals([item("c", 300)], known, 200)
    expect(arrivals.map((i) => i.post.id)).toEqual(["c"])
    expect(maxTs).toBe(300)
  })

  it("ignores an already-known slop even if it reappears at the top (Hot-rank shuffle)", () => {
    const { arrivals } = selectArrivals([item("a", 999)], known, 200)
    expect(arrivals).toEqual([])
  })

  it("ignores an unknown-but-OLD slop (older than the high-water mark)", () => {
    const { arrivals } = selectArrivals([item("z", 150)], known, 200)
    expect(arrivals).toEqual([])
  })

  it("orders multiple arrivals newest-first", () => {
    const { arrivals } = selectArrivals([item("c", 300), item("d", 500)], known, 200)
    expect(arrivals.map((i) => i.post.id)).toEqual(["d", "c"])
  })

  it("caps the live arrival layer", () => {
    const many = Array.from({ length: ARRIVALS_CAP + 5 }, (_, i) => item(`new-${i}`, 1000 + i))
    const { arrivals } = selectArrivals(many, known, 200)
    expect(arrivals).toHaveLength(ARRIVALS_CAP)
  })

  it("does not advance the high-water mark when nothing arrived", () => {
    const { maxTs } = selectArrivals([item("a", 50)], known, 200)
    expect(maxTs).toBe(200)
  })
})
