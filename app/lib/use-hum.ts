import { useEffect, useRef, useState } from "react"
import { useRevalidator } from "react-router"
import type { FeedItem } from "~/lib/domain"
import type { PulseEvent } from "~/db/pulse"
import { reviveFeedItem } from "~/lib/feed-wire"
import {
  ARRIVALS_CAP,
  HUM_BASE_DELAY_MS,
  humSignature,
  nextHumDelay,
  selectArrivals,
  type HumSnapshot,
  type WireHumSnapshot,
} from "~/lib/hum"

// THE HUM — the SINGLE owner of the city's live heartbeat (the-haunted-gallery.md move F).
// [LAW:no-ambient-temporal-coupling] All of the timing lives here and nowhere else: the slow
// poll, its backoff, the visibility gate, the reduced-motion gate, and the near-top flush. No
// component reads a clock or owns an interval; they render the values this hook returns.
//
// [LAW:effects-at-boundaries] The pure judgement (changed? new? next delay?) is app/lib/hum.ts;
// this hook is the effectful shell that runs it against the network and the DOM.
//
// The CD ruling (2026-06-23) shapes every gate: poll SLOW and back off when idle (the data has no
// heartbeat — never fake one), surface arrivals only at the TOP and only when the visitor is there
// to see them settle (non-displacing — nothing reflows under a reader), and let the crown's change
// ride the same poll for free.

// "At/near the top" — arrivals and a crown change are only COMMITTED to the DOM while the visitor
// is up here looking; scrolled past this, they accumulate silently and land when they return.
const NEAR_TOP_PX = 600
// On a tab regaining focus, poll almost immediately rather than waiting out the (possibly backed-off) delay.
const WAKE_DELAY_MS = 1_200

function maxCreatedAt(items: readonly FeedItem[]): number {
  return items.reduce((m, i) => Math.max(m, i.post.createdAt.getTime()), 0)
}

export type UseHumArgs = {
  // The loader's SSR baseline + the reset signal: a new loader run (navigation / sort change)
  // produces fresh references, which restart the live layer from the freshly-rendered page.
  loaderPulse: PulseEvent[]
  initialItems: FeedItem[]
  // The infinite-scroll tail, so an already-appended slop is never re-surfaced as an "arrival".
  extraItems: FeedItem[]
  // The currently-displayed crowned saint (bannerExcludeId); a poll naming a different crown
  // means the Rite turned over while the page was open.
  currentCrownId: string | null
}

export type HumState = {
  // The Pulse the strip renders — the loader's at first, then each poll's fresh stream.
  pulse: PulseEvent[]
  // Genuinely-new slop, newest-first, shown at the top of the wall once the visitor is near it.
  arrivals: FeedItem[]
}

export function useHum({ loaderPulse, initialItems, extraItems, currentCrownId }: UseHumArgs): HumState {
  const [pulse, setPulse] = useState<PulseEvent[]>(loaderPulse)
  const [arrivals, setArrivals] = useState<FeedItem[]>([])

  // [LAW:no-ambient-temporal-coupling] Mutable poll state lives in refs so the (mount-once) poll
  // loop reads the latest values without re-subscribing its timer every render.
  const maxTsRef = useRef<number>(maxCreatedAt(initialItems))
  const pendingRef = useRef<FeedItem[]>([])
  const pendingCrownRef = useRef<string | null>(null)
  const revalidatedCrownRef = useRef<string | null>(null)
  const delayRef = useRef<number>(HUM_BASE_DELAY_MS)
  const lastSigRef = useRef<string>("")

  // Latest render inputs, mirrored for the stable poll loop.
  const inputsRef = useRef({ initialItems, extraItems, arrivals, currentCrownId })
  inputsRef.current = { initialItems, extraItems, arrivals, currentCrownId }
  const revalidator = useRevalidator()
  const revalidateRef = useRef(revalidator.revalidate)
  revalidateRef.current = revalidator.revalidate

  // [LAW:one-source-of-truth] Page 1 always comes from the loader; the live layer is derived on top
  // of it. A fresh loader run (new initialItems reference) re-bases everything: the displayed Pulse
  // becomes the loader's again and the transient arrivals/crown state is cleared.
  useEffect(() => {
    setPulse(loaderPulse)
    setArrivals([])
    maxTsRef.current = maxCreatedAt(initialItems)
    pendingRef.current = []
    pendingCrownRef.current = null
    revalidatedCrownRef.current = null
    delayRef.current = HUM_BASE_DELAY_MS
    lastSigRef.current = ""
  }, [initialItems, loaderPulse])

  useEffect(() => {
    // [respect prefers-reduced-motion — static fallback everywhere] The Hum IS motion; a visitor
    // who asked for none gets the page exactly as it loaded, with no polling at all.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    // [LAW:dataflow-not-control-flow] Commit the buffered live layer only while the visitor is at
    // the top to watch it settle — otherwise it waits, so nothing ever reflows under a reader.
    const flush = () => {
      if (window.scrollY > NEAR_TOP_PX) return
      if (pendingRef.current.length > 0) {
        const incoming = pendingRef.current
        pendingRef.current = []
        setArrivals((prev) => [...incoming, ...prev].slice(0, ARRIVALS_CAP))
      }
      if (pendingCrownRef.current !== null) {
        revalidatedCrownRef.current = pendingCrownRef.current
        pendingCrownRef.current = null
        // A new saint settled while the page was open — re-run the loader so the gilt banner shows
        // the real new crown; RiteHero is keyed by the crown id, so the gold-settle replays on it.
        revalidateRef.current()
      }
    }

    const tick = async () => {
      if (cancelled) return
      // A hidden tab burns no requests; keep the timer alive and try again next interval.
      if (document.hidden) {
        timer = setTimeout(tick, delayRef.current)
        return
      }
      try {
        const res = await fetch("/api/hum")
        if (res.ok) {
          const wire = (await res.json()) as WireHumSnapshot
          const snap: HumSnapshot = {
            items: wire.items.map(reviveFeedItem),
            pulse: wire.pulse,
            crownedPostId: wire.crownedPostId,
          }
          const sig = humSignature(snap)
          const changed = sig !== lastSigRef.current
          lastSigRef.current = sig
          delayRef.current = nextHumDelay(delayRef.current, changed)

          if (changed) setPulse(snap.pulse)

          const { initialItems, extraItems, arrivals, currentCrownId } = inputsRef.current
          const known = new Set<string>()
          for (const i of initialItems) known.add(i.post.id)
          for (const i of extraItems) known.add(i.post.id)
          for (const i of arrivals) known.add(i.post.id)
          for (const i of pendingRef.current) known.add(i.post.id)
          const { arrivals: fresh, maxTs } = selectArrivals(snap.items, known, maxTsRef.current)
          maxTsRef.current = maxTs
          if (fresh.length > 0) {
            pendingRef.current = [...fresh, ...pendingRef.current].slice(0, ARRIVALS_CAP)
          }

          if (
            snap.crownedPostId !== null &&
            snap.crownedPostId !== currentCrownId &&
            snap.crownedPostId !== revalidatedCrownRef.current
          ) {
            pendingCrownRef.current = snap.crownedPostId
          }
          flush()
        } else {
          delayRef.current = nextHumDelay(delayRef.current, false)
        }
      } catch {
        // [LAW:no-silent-failure] An ambient-poll blip is not a page failure — back off and retry
        // on the next tick. This masks nothing: a persistent failure keeps retrying, plainly
        // visible in the network panel; it never falls back to stale-as-fresh or swallows the error.
        delayRef.current = nextHumDelay(delayRef.current, false)
      }
      if (!cancelled) timer = setTimeout(tick, delayRef.current)
    }

    const onScroll = () => flush()
    const onVisible = () => {
      if (document.hidden || cancelled) return
      // Tab regained focus — refresh soon instead of waiting out a backed-off delay.
      delayRef.current = HUM_BASE_DELAY_MS
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(tick, WAKE_DELAY_MS)
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    document.addEventListener("visibilitychange", onVisible)
    timer = setTimeout(tick, delayRef.current)

    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
      window.removeEventListener("scroll", onScroll)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  return { pulse, arrivals }
}
