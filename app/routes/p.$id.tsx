import type { Route } from "./+types/p.$id"
import { Link } from "react-router"
import { getFeedItemById } from "~/db/feed"
import { getGenealogy } from "~/db/genealogy-view"
import { listComments } from "~/db/comments"
import { readVoterId } from "~/lib/voter-cookie"
import { commentAuthorLabel } from "~/lib/author-label"
import { PostDetail } from "~/components/post-detail"
import { GenealogyView } from "~/components/genealogy"
import { shareMeta } from "~/lib/share-meta"
import { PostId } from "~/lib/domain"

// [LAW:single-enforcer] The permalink page route. Reuses getFeedItemById,
// which returns a RenderablePost — the same renderable shape getFeed
// projects per row, minus the list-position `rank` that only the feed
// view carries. The feed hands that renderable to PostCard as a dense tile;
// here PostDetail hangs the SAME renderable as the complete object — the media
// large and centred, its wall label beside it, the conversation below. One
// renderable shape, two viewpoints; the object never links to itself (the seam
// PostDetail inherits from ContentView's undefined href).
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
  // [LAW:dataflow-not-control-flow] The post, its genealogy, and its conversation are three independent
  // reads of the same id — fetch them together. The object page is the argument's HOME (8q9.4): it SSRs
  // the thread so the conversation is in the HTML, readable on load. [LAW:single-enforcer] the comments
  // serialize through the SAME author-label redaction the /api/posts/:id/comments loader uses — the raw
  // voter UUID never crosses this boundary; only the display label does.
  const [item, genealogy, comments] = await Promise.all([
    getFeedItemById(env, postId, readVoterId(request)),
    getGenealogy(env, postId),
    listComments(env, postId),
  ])
  if (item === null) {
    throw new Response("post not found", { status: 404 })
  }
  const initialComments = comments.map((c) => ({
    id: c.id,
    authorLabel: commentAuthorLabel(c.author),
    body: c.body,
    createdAt: c.createdAt.toISOString(),
  }))
  // [LAW:effects-at-boundaries] The request origin is world-state only this
  // boundary holds; extract it to a value here so meta() (which sees only a
  // client Location, never the host) can absolutize the share image's relative
  // /media/<sha> url against the host the link was served from.
  const origin = new URL(request.url).origin
  return { item, genealogy, origin, initialComments }
}

export function meta({ data }: Route.MetaArgs) {
  // [LAW:types-are-the-program] When the loader throws (404), `data` is
  // undefined — the meta function still runs, so guard on absence rather than
  // assuming the loader ran successfully. The component below never renders
  // in that case; ErrorBoundary takes over.
  if (data === undefined) {
    return [{ title: "Not found — SlopSpot" }]
  }
  // [LAW:single-enforcer] Share/preview tags (title, description, og:image,
  // twitter card) are minted in one place from the SAME RenderablePost the page
  // hangs — never re-derived here. This route is the adapter that hands the pure
  // deriver the renderable and the request origin.
  return shareMeta(data.item, data.origin)
}

export default function PermalinkPage({ loaderData }: Route.ComponentProps) {
  const { item, genealogy, initialComments } = loaderData
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      {/* The detail masthead is a breadcrumb, not the object's name. [LAW:one-source-of-truth]
          React Router's <Link> is the canonical in-app navigation primitive — client-side
          routing, no full-document reload. The serial is the object's stable machine identity
          in the terminal register (the pawnshop's guts), kept as the page h1 so every object
          page has exactly one, regardless of content kind; PostDetail's placard is the visual
          hero beneath it. The palette is the redesign's (bone/votive/ash), not the old white. */}
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-votive/15 pb-4">
        <Link
          to="/"
          className="font-terminal text-xs uppercase tracking-[0.25em] text-ash transition hover:text-votive"
        >
          ← back to the wall
        </Link>
        <h1 className="font-terminal text-sm text-votive/80">
          p:{item.post.id.slice(0, 8)}
        </h1>
      </header>
      {/* [LAW:dataflow-not-control-flow] item is the RenderablePost the loader returns; PostDetail
          arranges it as the complete object (media hero + wall label + conversation). Spread the
          renderable as one value — no frame prop, because the object is not a framed tile in a list. */}
      <PostDetail {...item} initialComments={initialComments} />
      {/* [LAW:dataflow-not-control-flow] The visual genealogy hangs beside the relic on the
          permalink — ancestry up, offspring down — derived from the lineage_edges DAG. It renders
          nothing for a founder with no offspring; the data is the discriminator. */}
      <GenealogyView genealogy={genealogy} />
    </main>
  )
}
