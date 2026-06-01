import type { Route } from "./+types/home"
import { data, Link } from "react-router"
import { getFeed } from "~/db/feed"
import { getPulse } from "~/db/pulse"
import { PostCard } from "~/components/post-card"
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

  const [items, pulse] = await Promise.all([
    getFeed(context.cloudflare.env, readVoterId(request), sort),
    getPulse(context.cloudflare.env),
  ])

  const serialized = serializeSortMode(sort)
  const headers: HeadersInit | undefined =
    serialized !== cookieRaw
      ? { 'Set-Cookie': serializeSortCookie(sort, url.protocol === 'https:') }
      : undefined

  return data({ items, pulse, sort }, { headers })
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { items, pulse, sort } = loaderData
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
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
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-ash/30 px-4 py-16 text-center font-terminal text-sm text-ash">
          nobody&apos;s here yet — the firehose hasn&apos;t fired. the silence is part of it.
        </p>
      ) : (
        <ul className="flex flex-col gap-5">
          {items.map((item) => (
            <li key={item.post.id}>
              <PostCard
                post={item.post}
                score={item.score}
                myVote={item.myVote}
                commentCount={item.commentCount}
                viewerIsModifier={item.viewerIsModifier}
              />
            </li>
          ))}
        </ul>
      )}
      <footer className="mt-16 border-t border-votive/15 pt-6 font-terminal text-xs text-ash flex items-center justify-between gap-4">
        <span>slopspot · {items.length} slops · open the cage and let the slop out</span>
        <Link to="/cast" className="transition-colors hover:text-votive/70">
          the cast
        </Link>
      </footer>
    </main>
  )
}
