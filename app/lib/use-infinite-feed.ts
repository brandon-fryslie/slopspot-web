import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import type { FeedItem } from "~/lib/domain"
import { reviveFeedItem, type WireFeedItem } from "~/lib/feed-wire"
import { sortModeUrlQuery, type SortMode } from "~/lib/sort-mode"

// [LAW:decomposition][LAW:composability] The cursor-paged infinite scroll is ONE part: given page 1
// (the loader's SSR result) and a sort, it advances an opaque cursor as a sentinel intersects,
// appending each /api/feed page's revived FeedItems until the cursor runs out. It asks only for the
// page-1 seed + the sort + the banner-excluded id — nothing about how the wall renders — so it drops
// into any list that wants a cursor-paged tail and is drivable in isolation (a real IntersectionObserver
// in a headless browser, with fetch stubbed) by the scroll regression guard. Home composes it: it
// owns page 1 and renders [...firstPage, ...extraItems]; this hook owns only the appended tail.

export interface InfiniteFeedInput {
  // Page 1 from the loader. Read only as an identity: a loader re-run (e.g. a sort change) yields a
  // fresh firstPage, which restarts the scroll from the new page 1. [LAW:one-source-of-truth]
  firstPage: FeedItem[]
  firstCursor: string | null
  sort: SortMode
  // The banner-excluded post id (the crowned relic hung once above the wall), or null when the banner
  // hangs no relic. The SAME uniform filter the loader applied to page 1, extended to every appended
  // page so the gilt relic is never also a tile.
  excludeId: string | null
}

export interface InfiniteFeed {
  extraItems: FeedItem[]
  cursor: string | null
  loading: boolean
  sentinelRef: RefObject<HTMLDivElement | null>
}

export function useInfiniteFeed({ firstPage, firstCursor, sort, excludeId }: InfiniteFeedInput): InfiniteFeed {
  // [LAW:dataflow-not-control-flow] `cursor === null` is the DATA that ends the scroll — the observer
  // has nothing left to advance to, not a branch that tears the component down.
  const [extraItems, setExtraItems] = useState<FeedItem[]>([])
  const [cursor, setCursor] = useState<string | null>(firstCursor)
  const [loading, setLoading] = useState(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // A sort change re-runs the loader → a fresh page-1 (new firstPage identity) → restart the scroll
  // from it. [LAW:one-source-of-truth] page 1 always comes from the loader; only the appended tail is
  // local state, so a stale cursor can never out-live its sort.
  useEffect(() => {
    setExtraItems([])
    setCursor(firstCursor)
  }, [firstPage, firstCursor])

  const loadMore = useCallback(async () => {
    if (loading || cursor === null) return
    setLoading(true)
    try {
      const res = await fetch(`/api/feed?${sortModeUrlQuery(sort)}&cursor=${encodeURIComponent(cursor)}`)
      // [LAW:single-enforcer] reviveFeedItem (feed-wire.ts) owns the wire→domain boundary: /api/feed
      // serializes Dates to ISO strings (Response.json), so an appended row's post.createdAt must be
      // revived to a Date or PostCard's relativeTime throws. The wire shape is honest (createdAt: string).
      const next = (await res.json()) as { items: WireFeedItem[]; nextCursor: string | null }
      // [LAW:one-source-of-truth] The crowned hero is hung once (the gold relic); it must never ALSO
      // appear as a wall tile — the loader filter enforces this on page 1; the SAME uniform predicate
      // (excludeId) extends it to every appended page (null when the banner hangs no relic, so it
      // matches nothing during deliberation/empty).
      const revived = next.items.map(reviveFeedItem).filter((i) => i.post.id !== excludeId)
      setExtraItems((prev) => [...prev, ...revived])
      setCursor(next.nextCursor)
    } finally {
      setLoading(false)
    }
  }, [loading, cursor, sort, excludeId])

  // [LAW:dataflow-not-control-flow] One observer. `rootMargin` prefetches the next page ~600px before
  // the sentinel is visible so the scroll never stalls; when `cursor === null` the effect attaches
  // nothing, so the feed simply ends.
  useEffect(() => {
    const el = sentinelRef.current
    if (el === null || cursor === null) return
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) void loadMore() },
      { rootMargin: '600px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [loadMore, cursor])

  return { extraItems, cursor, loading, sentinelRef }
}
