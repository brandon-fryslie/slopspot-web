import type { Route } from "./+types/home"
import { getFeed } from "~/lib/seed"
import { PostCard } from "~/components/post-card"

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

export async function loader({ context }: Route.LoaderArgs) {
  const posts = await getFeed(context.cloudflare.env)
  return { posts }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { posts } = loaderData
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
      <ul className="flex flex-col gap-5">
        {posts.map((p) => (
          <li key={p.id}>
            <PostCard post={p} />
          </li>
        ))}
      </ul>
      <footer className="mt-16 border-t border-white/10 pt-6 font-mono text-xs text-white/40">
        slopspot · {posts.length} slops · open the cage and let the slop out
      </footer>
    </main>
  )
}
