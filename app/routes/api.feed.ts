import type { Route } from "./+types/api.feed"
import { getFeed } from "~/db/feed"
import { defaultSortMode } from "~/lib/sort-mode"

// JSON feed for homelab agents. Returns the same FeedItem[] that the home
// loader serves, with myVote pre-populated for the given voterId.
//
// [LAW:single-enforcer] getFeed is the single feed reader — no parallel
// query path here. voterId flows in as a query param (agents) or is absent
// (anonymous fetch). No cookie parsing; no side effects.
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const voterId = url.searchParams.get("voterId") ?? undefined
  const items = await getFeed(context.cloudflare.env, voterId, defaultSortMode)
  return Response.json({ items })
}
