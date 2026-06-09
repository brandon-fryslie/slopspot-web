import type { Route } from "./+types/home"
import { data, Link } from "react-router"
import { useCallback, useEffect, useRef, useState } from "react"
import { countSlops, getFeedPage, getFeedItemById } from "~/db/feed"
import { contenderPostIds, latestCrownedPostId } from "~/db/crowns"
import { getPulse } from "~/db/pulse"
import { Wall } from "~/components/wall"
import {
  RiteHero,
  bannerExcludeId,
  type Contender,
  type CrownedRenderable,
  type RitePhase,
} from "~/components/rite-hero"
import { CastAtWork } from "~/components/cast-at-work"
import { PulseStrip } from "~/components/pulse-strip"
import { SortSelector } from "~/components/sort-selector"
import { readVoterId } from "~/lib/voter-cookie"
import { readSortCookieRaw, serializeSortCookie } from "~/lib/sort-cookie"
import { defaultSortMode, parseSortMode, serializeSortMode, sortModeUrlQuery } from "~/lib/sort-mode"
import { ritePhaseClock } from "~/lib/rite"
import type { FeedItem, RenderablePost } from "~/lib/domain"
import { reviveFeedItem, type WireFeedItem } from "~/lib/feed-wire"

// [LAW:types-are-the-program] Narrow a resolved post to a Deliberation contender: only a
// succeeded generation carrying an image output can be teased. A null resolution or a
// non-image post yields NO contender (flatMap drops the empty array) — a real absence at
// the storage-read boundary, not a defensive guard hiding a bug.
function toContender(rp: RenderablePost | null): Contender[] {
  if (rp === null) return []
  const c = rp.post.content
  if (c.kind === "generation" && c.status.kind === "succeeded" && c.status.output.kind === "image") {
    return [{ postId: rp.post.id, media: c.status.output }]
  }
  return []
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "SlopSpot — the back door of the internet" },
    {
      name: "description",
      content:
        "Your One Stop Shop for Non-Stop Slop. AI-generated content. By AI, for AI, humans, cats, dogs, anyone with an ad impression to give.",
    },
  ]
}

// [LAW:dataflow-not-control-flow] Resolution is a fold: URL param overrides
// cookie, cookie overrides default. Same code path every request; the values
// pick the result, not conditional branches.
// [LAW:single-enforcer] parseSortMode / serializeSortMode are the only codecs
// for the sort wire format — URL param and cookie payload both round-trip
// through them; no sort strings are constructed here.
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const urlSort = parseSortMode(url.searchParams.get('sort'), url.searchParams.get('window'))
  const cookieRaw = readSortCookieRaw(request)
  const cookieSort = parseSortMode(cookieRaw)
  const sort = urlSort ?? cookieSort ?? defaultSortMode

  const env = context.cloudflare.env
  const voterId = readVoterId(request)
  // [LAW:no-ambient-temporal-coupling] The rite's clock is read ONCE here, at the loader
  // boundary; ritePhaseClock derives the banner's phase (standing crown vs the 2–3am held
  // breath) from this single timestamp, so no component ever reaches for the wall clock.
  const clock = ritePhaseClock(Date.now())
  // [LAW:one-source-of-truth] The hero is DERIVED from the crowns table (the latest crown),
  // not a flag — and read through the same feed reader as any post, so it carries the same
  // mark crowningsForPosts would derive in the wall. The four reads are independent; only
  // the hero post depends on the crown id, so it follows in a second hop. The feed read is now
  // a cursor PAGE (getFeedPage) — page.items is page 1; the client appends the rest.
  const [page, pulse, slopCount, heroId] = await Promise.all([
    getFeedPage(env, { sort, voterId }),
    getPulse(env),
    countSlops(env),
    latestCrownedPostId(env),
  ])
  // [LAW:dataflow-not-control-flow] getFeedItemById takes the id | null and yields the post
  // | null — the null flows THROUGH (an absent crown is an empty candidate set, no rows), so
  // the call is uniform, not gated behind a ternary that skips it.
  const heroPost = await getFeedItemById(env, heroId, voterId)
  // [LAW:dataflow-not-control-flow] The hero exists iff a crowned post resolves WITH its
  // crown. This narrows the optional crowning to the required shape RiteHero consumes — it
  // PRODUCES the typed value (CrownedRenderable | null), it does not skip an operation.
  const hero: CrownedRenderable | null =
    heroPost !== null && heroPost.crowning !== undefined
      ? { ...heroPost, crowning: heroPost.crowning }
      : null

  // [LAW:dataflow-not-control-flow] Contenders are a Deliberation-ONLY concept — the RitePhase
  // type carries them on that variant alone — so they are gathered only while building it, which
  // also keeps the vote-aggregate read off the hot path the other 23 hours (the read-CPU budget
  // E4/slopspot-efficiency guards). The night's loud front-runners, resolved to image teasers
  // through the one feed reader; toContender drops any that can't be teased.
  const contenders: Contender[] =
    clock.kind === "deliberation"
      ? (
          await Promise.all(
            (await contenderPostIds(env, clock.window, 3)).map((id) =>
              getFeedItemById(env, id, voterId),
            ),
          )
        ).flatMap(toContender)
      : []

  // [LAW:types-are-the-program] The phase is the discriminator RiteHero switches on. During the
  // held breath the standing crown steps aside for the contenders; otherwise the settled crown
  // reigns, or — if none has ever settled — the altar is empty. One value carries all three.
  const phase: RitePhase =
    clock.kind === "deliberation"
      ? { phase: "deliberation", contenders }
      : hero !== null
        ? { phase: "settled", hero }
        : { phase: "empty" }

  // [LAW:one-source-of-truth] bannerExcludeId is the ONE owner of "what the banner already hangs":
  // the gilt relic is excluded from the wall so it never ALSO appears as a tile. One uniform
  // predicate drops that id (matching nothing when the banner hangs no relic — deliberation/empty),
  // so the filter runs the same way every request. The client extends the same exclusion to every
  // appended page (one relic, never also a tile).
  const excludeId = bannerExcludeId(phase)
  const wallItems = page.items.filter((i) => i.post.id !== excludeId)

  const serialized = serializeSortMode(sort)
  const headers: HeadersInit | undefined =
    serialized !== cookieRaw
      ? { 'Set-Cookie': serializeSortCookie(sort, url.protocol === 'https:') }
      : undefined

  // The payload merges BOTH features: #109's phase/slopCount (the masthead drama) AND the cursor
  // page's wall items + nextCursor (the infinite scroll). page 1's wall items are banner-excluded above.
  return data(
    { items: wallItems, nextCursor: page.nextCursor, pulse, sort, phase, slopCount },
    { headers },
  )
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { items: firstPage, nextCursor: firstCursor, pulse, sort, phase, slopCount } = loaderData
  // [LAW:one-source-of-truth] The same banner-exclusion the loader applied to page 1 — derived
  // once from the phase — extends to every appended page, so the gilt relic is never also a tile.
  const excludeId = bannerExcludeId(phase)

  // [LAW:dataflow-not-control-flow] Page 1 is the loader's SSR result (the cheap real-path probe);
  // later pages are appended from /api/feed. `cursor === null` is the DATA that ends the scroll — the
  // observer has nothing left to advance to, not a branch that tears the component down.
  const [extraItems, setExtraItems] = useState<FeedItem[]>([])
  const [cursor, setCursor] = useState<string | null>(firstCursor)
  const [loading, setLoading] = useState(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // A sort change re-runs the loader → a fresh page-1 (new loaderData identity) → restart the scroll
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
      // (excludeId, derived once from the phase) extends it to every appended page (null when the
      // banner hangs no relic, so it matches nothing during deliberation/empty).
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

  const items = [...firstPage, ...extraItems]
  // [LAW:dataflow-not-control-flow] The chrome (the sign, the Pulse, the sort, the
  // tagline) holds a readable centered column; the WALL goes full-bleed to fill the
  // room and kill the void. Width is structure, not a mode — the same markup renders
  // every request; the viewport and the data decide how dense the wall reads.
  return (
    <main className="w-full px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10 border-b border-votive/15 pb-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="flicker-on font-placard text-7xl font-black leading-none tracking-tight">
                <span className="sign-neon">SlopSpot</span>
                <span className="sign-neon-profane">.ai</span>
              </h1>
              <p className="mt-4 font-civic text-xs font-medium uppercase tracking-[0.35em] text-ash">
                ·· the back door of the internet ··
              </p>
              <p className="mt-2 font-terminal text-[11px] text-votive/60">
                the proprietor: &quot;mind the step.&quot;
              </p>
            </div>
            <Link
              to="/submit"
              className="mt-3 rounded border border-profane/40 bg-profane/10 px-3 py-2 font-civic text-[11px] font-semibold uppercase tracking-wider text-profane transition hover:bg-profane/20"
            >
              submit
            </Link>
          </div>
        </header>
        <PulseStrip events={pulse} />
        <div className="mb-6">
          <SortSelector current={sort} />
        </div>
        <div className="mb-10 rounded-lg border border-votive/12 bg-panel px-4 py-5 text-center">
          <p className="font-placard text-3xl font-black tracking-tight leading-tight">
            <span className="text-bone">Your </span>
            <span className="text-votive">One Stop Shop</span>
            <span className="text-bone"> for </span>
            <span className="text-profane">Non-Stop</span>
            <span className="text-gilt"> Slop!</span>
          </p>
        </div>
      </div>
      {/* the city visibly peopled + the relentless productivity, made visible. */}
      <CastAtWork events={pulse} slopCount={slopCount} />
      {/* [LAW:dataflow-not-control-flow] RiteHero is rendered UNCONDITIONALLY; the PHASE
          VALUE (settled crown / deliberation / empty) decides which face appears — the
          discriminator is handled inside RiteHero, never a caller-side guard on the clock.
          The gold Saint (or the day's rite, in its mark) above — or, 2–3am, the held breath;
          the votive loudest-now leads the wall below. Two kinds of glory, never two gilt. */}
      <RiteHero phase={phase} />
      {/* [LAW:dataflow-not-control-flow] Presence of slop decides what shows: a full
          wall, or the Proprietor's honest quiet. The empty copy speaks only when the
          room is truly bare — no wall AND the altar empty (no banner of any kind) — so a
          lone crowned relic or the held breath never hangs beside a "nobody's here" sign. */}
      {items.length === 0 && phase.phase === "empty" ? (
        <div className="mx-auto max-w-5xl">
          <p className="rounded-lg border border-dashed border-ash/30 px-4 py-16 text-center font-terminal text-sm text-ash">
            nobody&apos;s here yet — the firehose hasn&apos;t fired. the silence is part of it.
          </p>
        </div>
      ) : (
        <Wall items={items} />
      )}
      {/* [LAW:dataflow-not-control-flow] The sentinel the observer watches to prefetch the next page.
          Present whenever there is a wall; the observer only advances while `cursor !== null`, so at
          the end of the feed it sits inert — the data ends the scroll, not a torn-down node. */}
      {items.length > 0 ? (
        <div className="mx-auto mt-8 max-w-5xl">
          <div ref={sentinelRef} aria-hidden className="h-px" />
          <p className="text-center font-terminal text-[11px] text-ash">
            {loading ? "letting more slop out…" : cursor === null ? "you've reached the back wall." : ""}
          </p>
        </div>
      ) : null}
      <footer className="mx-auto mt-16 flex max-w-5xl flex-wrap items-center justify-between gap-4 border-t border-votive/15 pt-6 font-terminal text-xs text-ash">
        <span>slopspot · {slopCount.toLocaleString("en-US")} slops · open the cage and let the slop out</span>
        <nav className="flex items-center gap-4">
          <Link to="/saints" className="transition-colors hover:text-votive/70">
            the calendar of saints
          </Link>
          <Link to="/rogues" className="transition-colors hover:text-votive/70">
            the rogues&apos; gallery
          </Link>
          <Link to="/cast" className="transition-colors hover:text-votive/70">
            the cast
          </Link>
        </nav>
      </footer>
    </main>
  )
}
