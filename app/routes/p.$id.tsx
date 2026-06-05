import type { Route } from "./+types/p.$id"
import { Link } from "react-router"
import { getFeedItemById } from "~/db/feed"
import { getGenealogy } from "~/db/genealogy-view"
import { readVoterId } from "~/lib/voter-cookie"
import { PostCard } from "~/components/post-card"
import { GenealogyView } from "~/components/genealogy"
import { PostId } from "~/lib/domain"

// [LAW:single-enforcer] The permalink page route. Reuses getFeedItemById,
// which returns a RenderablePost — the same renderable shape getFeed
// projects per row, minus the list-position `rank` that only the feed
// view carries. PostCard consumes that renderable directly; the only things
// each viewpoint adds are the presentation variables it owns — the feed assigns
// a crowned/study frame level by prominence and carries rank, the permalink
// hangs a lone relic as "standalone". One renderable shape, two viewpoints.
//
// [LAW:locality-or-seam] The fork submit handler navigates to /p/<newId> to
// solve the "I forked a post and now I can't see it" UX gap from ec7.3 —
// score-0 forks land below higher-scored posts in the (score DESC, createdAt
// DESC) feed order, so "navigate to /" leaves the user with no signal that
// their fork succeeded. /p/:id is the natural redirect target because it's
// already what shareable links want to be.

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const postId = PostId(params.id)
  // [LAW:dataflow-not-control-flow] The post and its genealogy are independent reads of the same
  // id — fetch them together. The genealogy folds the lineage_edges subgraph reachable from this
  // post; a founder with no offspring yields an empty Genealogy the view renders as nothing.
  const [item, genealogy] = await Promise.all([
    getFeedItemById(env, postId, readVoterId(request)),
    getGenealogy(env, postId),
  ])
  if (item === null) {
    throw new Response("post not found", { status: 404 })
  }
  return { item, genealogy }
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
  const { item, genealogy } = loaderData
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="mb-8 border-b border-white/10 pb-6">
        {/* [LAW:one-source-of-truth] React Router's <Link> is the canonical
            in-app navigation primitive: client-side routing, no full
            document reload, preserves SPA state. A bare <a href="/"> would
            tear down React and refetch the whole bundle for an in-app
            destination — wrong tool for an internal jump. */}
        <Link
          to="/"
          className="font-mono text-xs uppercase tracking-[0.25em] text-white/40 transition hover:text-white/70"
        >
          ← back to slopspot
        </Link>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-white">
          <span className="font-mono text-xl text-emerald-400">
            p:{item.post.id.slice(0, 8)}
          </span>
        </h1>
      </header>
      {/* [LAW:dataflow-not-control-flow] item is the RenderablePost the loader
          returns; the route names the frame LEVEL its container owns — a lone
          permalinked relic hangs "standalone". Spread the renderable as one value
          and name the level beside it; the type system carries the contract. */}
      <PostCard {...item} frame={{ kind: "standalone" }} />
      {/* [LAW:dataflow-not-control-flow] The visual genealogy hangs beside the relic on the
          permalink — ancestry up, offspring down — derived from the lineage_edges DAG. It renders
          nothing for a founder with no offspring; the data is the discriminator. */}
      <GenealogyView genealogy={genealogy} />
    </main>
  )
}
