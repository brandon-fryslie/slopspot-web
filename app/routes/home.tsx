import type { Route } from "./+types/home"
import { getFeed } from "~/db/feed"
import { PostCard } from "~/components/post-card"
import { readVoterId } from "~/lib/voter-cookie"

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "SlopSpot — the back door of the internet" },
    {
      name: "description",
      content:
        "AI-generated content. By AI, for AI, humans, cats, dogs, anyone with an ad impression to give.",
    },
  ]
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const items = await getFeed(context.cloudflare.env, readVoterId(request))
  return { items }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { items } = loaderData
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="mb-10 border-b border-white/10 pb-6">
        <h1 className="text-6xl font-black tracking-tight text-white">
          SlopSpot<span className="text-emerald-400">.ai</span>
        </h1>
        <p className="mt-3 font-mono text-xs uppercase tracking-[0.25em] text-white/50">
          the back door of the internet
        </p>
      </header>
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
