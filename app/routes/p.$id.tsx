import type { Route } from "./+types/p.$id"
import { getFeedItemById } from "~/db/feed"
import { readVoterId } from "~/lib/voter-cookie"
import { PostCard } from "~/components/post-card"
import { PostId } from "~/lib/domain"

// [LAW:single-enforcer] The permalink page route. Reuses getFeedItemById,
// which produces the same FeedItem shape getFeed produces per row — so a post
// rendered here looks identical to the same post rendered in the feed list
// (same PostCard, same score / commentCount / myVote semantics). No second
// renderer, no second data shape; one mapping, two viewpoints.
//
// [LAW:locality-or-seam] The fork submit handler navigates to /p/<newId> to
// solve the "I forked a post and now I can't see it" UX gap from ec7.3 —
// score-0 forks land below higher-scored posts in the (score DESC, createdAt
// DESC) feed order, so "navigate to /" leaves the user with no signal that
// their fork succeeded. /p/:id is the natural redirect target because it's
// already what shareable links want to be.

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const item = await getFeedItemById(
    context.cloudflare.env,
    PostId(params.id),
    readVoterId(request),
  )
  if (item === null) {
    throw new Response("post not found", { status: 404 })
  }
  return { item }
}

export function meta({ data }: Route.MetaArgs) {
  // [LAW:types-are-the-program] When the loader throws (404), `data` is
  // undefined — the meta function still runs, so guard on absence rather than
  // assuming the loader ran successfully. The component below never renders
  // in that case; ErrorBoundary takes over.
  if (data === undefined) {
    return [{ title: "Not found — SlopSpot" }]
  }
  return [
    {
      title: `p:${data.item.post.id.slice(0, 8)} — SlopSpot`,
    },
  ]
}

export default function PermalinkPage({ loaderData }: Route.ComponentProps) {
  const { item } = loaderData
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="mb-8 border-b border-white/10 pb-6">
        <a
          href="/"
          className="font-mono text-xs uppercase tracking-[0.25em] text-white/40 transition hover:text-white/70"
        >
          ← back to slopspot
        </a>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-white">
          <span className="font-mono text-xl text-emerald-400">
            p:{item.post.id.slice(0, 8)}
          </span>
        </h1>
      </header>
      <PostCard
        post={item.post}
        score={item.score}
        myVote={item.myVote}
        commentCount={item.commentCount}
      />
    </main>
  )
}
