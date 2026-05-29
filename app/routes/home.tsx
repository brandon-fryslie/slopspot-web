import type { Route } from "./+types/home"
import { data, Link } from "react-router"
import { getFeed } from "~/db/feed"
import { PostCard } from "~/components/post-card"
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

  const items = await getFeed(context.cloudflare.env, readVoterId(request), sort)

  const serialized = serializeSortMode(sort)
  const headers: HeadersInit | undefined =
    serialized !== cookieRaw
      ? { 'Set-Cookie': serializeSortCookie(sort, url.protocol === 'https:') }
      : undefined

  return data({ items, sort }, { headers })
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="mb-10 border-b border-white/10 pb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-6xl font-black tracking-tight text-white">
              SlopSpot<span className="text-emerald-400">.ai</span>
            </h1>
            <p className="mt-3 font-mono text-xs uppercase tracking-[0.25em] text-white/50">
              the back door of the internet
            </p>
          </div>
          <Link
            to="/submit"
            className="mt-2 rounded bg-emerald-400/20 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-400/30"
          >
            submit
          </Link>
        </div>
      </header>
      <div className="mb-10 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-5 text-center">
        <p className="text-3xl font-black tracking-tight leading-tight">
          <span className="text-white">Your </span>
          <span className="text-emerald-400">One Stop Shop</span>
          <span className="text-white"> for </span>
          <span className="text-fuchsia-400">Non-Stop</span>
          <span className="text-amber-400"> Slop!</span>
        </p>
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/15 px-4 py-16 text-center font-mono text-sm text-white/40">
          no slops yet — the firehose hasn&apos;t fired
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
              />
            </li>
          ))}
        </ul>
      )}
      <footer className="mt-16 border-t border-white/10 pt-6 font-mono text-xs text-white/40">
        slopspot · {items.length} slops · open the cage and let the slop out
      </footer>
    </main>
  )
}
