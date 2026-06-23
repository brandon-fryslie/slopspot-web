import type { Route } from "./+types/dynasty.$id"
import { Link } from "react-router"
import { getDynasty } from "~/db/genealogy-view"
import { getDynastyChronicle } from "~/db/dynasty-chronicle"
import { getPostById } from "~/db/feed"
import { DynastyChronicleView, DynastyView } from "~/components/genealogy"
import { PostId } from "~/lib/domain"

// [LAW:single-enforcer][LAW:one-type-per-behavior] The whole-DYNASTY route (slopspot-genome-p6z.2):
// /dynasty/:id renders the founder-rooted whole-bloodline forest for the post's lineage — one level UP
// from the per-post tree on /p/:id. 'dynasty' is the corpus's native unit (one bloodline); /genome is
// RESERVED for the future global forest-aggregate (p6z.2.1). The fold (getDynasty) composes on the same
// lineage_edges source the per-post tree uses — no parallel ancestry store.
//
// [LAW:dataflow-not-control-flow] A non-existent or non-generation root is a 404 (no genome, no
// dynasty); a real generation yields its founder forest, which the view renders by data (a lone founder
// is its own one-node dynasty). The depth/lineage are DERIVED from lineage_edges, never re-defined here.
export async function loader({ params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const postId = PostId(params.id)
  const post = await getPostById(env, postId)
  // Only a generation carries a genome (and thus a bloodline); an upload/found or a missing id has no
  // dynasty to root. Fail to a 404 rather than a blank page or a corruption throw downstream.
  if (post === null || post.content.kind !== "generation") {
    throw new Response("dynasty not found", { status: 404 })
  }
  // [LAW:no-ambient-temporal-coupling] The standing window edge is the request's clock, taken once here at
  // the boundary and handed to the chronicle fold — never reached for inside the read.
  const [dynasty, chronicle] = await Promise.all([
    getDynasty(env, postId),
    getDynastyChronicle(env, postId, Date.now()),
  ])
  return { dynasty, chronicle }
}

export default function DynastyPage({ loaderData }: Route.ComponentProps) {
  const { dynasty, chronicle } = loaderData
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link to="/" className="font-terminal text-[11px] text-ash hover:text-votive/80">
        ← the feed
      </Link>
      <div className="mt-4">
        <DynastyView dynasty={dynasty} />
        <DynastyChronicleView chronicle={chronicle} />
      </div>
    </main>
  )
}
