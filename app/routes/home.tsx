import type { Route } from "./+types/home"
import { data, Link } from "react-router"
import { countSlops, getFeed, getFeedItemById } from "~/db/feed"
import { latestCrownedPostId } from "~/db/crowns"
import { getPulse } from "~/db/pulse"
import { Wall } from "~/components/wall"
import { RiteHero, type CrownedRenderable } from "~/components/rite-hero"
import { CastAtWork } from "~/components/cast-at-work"
import { PulseStrip } from "~/components/pulse-strip"
import { SortSelector } from "~/components/sort-selector"
import { readVoterId } from "~/lib/voter-cookie"
import { readSortCookieRaw, serializeSortCookie } from "~/lib/sort-cookie"
import { defaultSortMode, parseSortMode, serializeSortMode } from "~/lib/sort-mode"

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
  // [LAW:one-source-of-truth] The hero is DERIVED from the crowns table (the latest crown),
  // not a flag — and read through the same feed reader as any post, so it carries the same
  // mark crowningsForPosts would derive in the wall. The four reads are independent; only
  // the hero post depends on the crown id, so it follows in a second hop.
  const [items, pulse, slopCount, heroId] = await Promise.all([
    getFeed(env, voterId, sort),
    getPulse(env),
    countSlops(env),
    latestCrownedPostId(env),
  ])
  const heroPost = heroId === null ? null : await getFeedItemById(env, heroId, voterId)
  // [LAW:dataflow-not-control-flow] The hero exists iff a crowned post resolves WITH its
  // crown — the value, never a flag. The narrowing makes "a hero with no mark" absent here,
  // so RiteHero never defends an impossible state.
  const hero: CrownedRenderable | null =
    heroPost !== null && heroPost.crowning !== undefined
      ? { ...heroPost, crowning: heroPost.crowning }
      : null
  // [LAW:one-source-of-truth] The hero is hung above the wall; the wall is everything else.
  // A post is one relic — showing the crown as both the gold hero AND a wall tile would be
  // two of the same. The hero's id is removed so the loudest-now focal is the loudest that
  // ISN'T already the standing crown.
  const wallItems = hero === null ? items : items.filter((i) => i.post.id !== hero.post.id)

  const serialized = serializeSortMode(sort)
  const headers: HeadersInit | undefined =
    serialized !== cookieRaw
      ? { 'Set-Cookie': serializeSortCookie(sort, url.protocol === 'https:') }
      : undefined

  return data({ items: wallItems, pulse, sort, hero, slopCount }, { headers })
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { items, pulse, sort, hero, slopCount } = loaderData
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
      {/* [LAW:dataflow-not-control-flow] The hero hangs iff a crown resolved — its presence
          is the discriminator, never an isCrowned flag. The gold Saint (or the day's rite,
          in its mark) above; the votive loudest-now leads the wall below. Two kinds of
          glory, never two gilt. */}
      {hero !== null && <RiteHero hero={hero} />}
      {/* [LAW:dataflow-not-control-flow] Presence of slop decides what shows: a full
          wall, or the Proprietor's honest quiet. The empty copy speaks only when the
          room is truly bare — no wall AND no standing crown — so a lone crowned relic
          never hangs beside a "nobody's here" sign. The silence is part of it. */}
      {items.length === 0 && hero === null ? (
        <div className="mx-auto max-w-5xl">
          <p className="rounded-lg border border-dashed border-ash/30 px-4 py-16 text-center font-terminal text-sm text-ash">
            nobody&apos;s here yet — the firehose hasn&apos;t fired. the silence is part of it.
          </p>
        </div>
      ) : (
        <Wall items={items} />
      )}
      <footer className="mx-auto mt-16 flex max-w-5xl items-center justify-between gap-4 border-t border-votive/15 pt-6 font-terminal text-xs text-ash">
        <span>slopspot · {slopCount.toLocaleString("en-US")} slops · open the cage and let the slop out</span>
        <Link to="/cast" className="transition-colors hover:text-votive/70">
          the cast
        </Link>
      </footer>
    </main>
  )
}
