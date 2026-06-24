import type { FeedItem } from "~/lib/domain"
import type { WireFeedItem } from "~/lib/feed-wire"
import type { PulseEvent } from "~/db/pulse"
import { pulseEventKey } from "~/lib/pulse-key"

// THE HUM — the city's live heartbeat (the-haunted-gallery.md move F). This module is the
// PURE core of the live poll: the wire shape, the change-signature, the backoff schedule, and
// the arrival selection. [LAW:effects-at-boundaries] no timers, no fetch, no DOM here — those
// live in the useHum hook; everything in this file is a referentially-transparent function so
// the poll's judgement (did anything change? what is genuinely new? how long until the next
// poll?) is testable without a browser.

// [LAW:types-are-the-program] The wire snapshot is what /api/hum serialises: the newest page-0
// of slop, the Pulse stream, and the id of the currently-crowned saint (the cheap "rite state"
// the gold-settle rides on). items cross the wire as WireFeedItem (Date → ISO string), pulse is
// already all-primitive so it needs no revival.
export type WireHumSnapshot = {
  items: WireFeedItem[]
  pulse: PulseEvent[]
  crownedPostId: string | null
}

// The revived snapshot the client renders — items are true FeedItems (createdAt is a Date).
export type HumSnapshot = {
  items: FeedItem[]
  pulse: PulseEvent[]
  crownedPostId: string | null
}

// The data has no heartbeat (~1 fire / 18min, irregular votes), so we poll SLOW and BACK OFF
// when nothing changes — never faking a pulse the data lacks (CD ruling 2026-06-23, q1).
export const HUM_BASE_DELAY_MS = 30_000
export const HUM_MAX_DELAY_MS = 120_000
const HUM_BACKOFF_FACTOR = 1.5

// Arrivals accumulate while a visitor watches; cap the live strip so a long idle session can't
// grow it unbounded. A refresh re-ranks everything anyway, so a cap drops nothing real — it
// just bounds the transient live layer. ~1 fire/18min makes 12 generous.
export const ARRIVALS_CAP = 12

// [LAW:dataflow-not-control-flow] A cheap content signature: the newest slop id, the newest
// Pulse event's STABLE identity (pulseEventKey, which ignores the feast's volatile nowMs), and
// the crowned saint. Equal signatures across two polls ⇒ nothing changed ⇒ back off.
export function humSignature(snap: {
  items: readonly { post: { id: string } }[]
  pulse: readonly PulseEvent[]
  crownedPostId: string | null
}): string {
  const topItem = snap.items[0]?.post.id ?? ""
  const topPulse = snap.pulse[0]
  const pulseKey = topPulse !== undefined ? pulseEventKey(topPulse) : ""
  return `${topItem}|${pulseKey}|${snap.crownedPostId ?? ""}`
}

// [LAW:dataflow-not-control-flow] The interval is DATA derived from one fact: did the last poll
// change anything? A change resets to the base cadence (the city is active, stay close); an
// unchanged poll grows the delay geometrically up to the cap (idle, ease off).
export function nextHumDelay(current: number, changed: boolean): number {
  if (changed) return HUM_BASE_DELAY_MS
  return Math.min(Math.round(current * HUM_BACKOFF_FACTOR), HUM_MAX_DELAY_MS)
}

// [LAW:dataflow-not-control-flow] A genuine ARRIVAL is a slop the visitor has never seen whose
// creation time is newer than everything they hold — so a mere rank-shuffle (an old post rising
// in Hot) is NOT mistaken for a new arrival; only the firehose's real output is. Returns the
// arrivals (newest-first, capped) and the advanced high-water timestamp.
export function selectArrivals(
  items: readonly FeedItem[],
  knownIds: ReadonlySet<string>,
  maxKnownTs: number,
): { arrivals: FeedItem[]; maxTs: number } {
  const fresh = items.filter(
    (i) => !knownIds.has(i.post.id) && i.post.createdAt.getTime() > maxKnownTs,
  )
  fresh.sort((a, b) => b.post.createdAt.getTime() - a.post.createdAt.getTime())
  const maxTs = fresh.reduce((m, i) => Math.max(m, i.post.createdAt.getTime()), maxKnownTs)
  return { arrivals: fresh.slice(0, ARRIVALS_CAP), maxTs }
}
