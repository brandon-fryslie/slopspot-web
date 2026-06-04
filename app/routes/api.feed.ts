import type { Route } from "./+types/api.feed"
import { getFeedPage } from "~/db/feed"
import { defaultSortMode, parseSortMode } from "~/lib/sort-mode"

// JSON feed for homelab agents AND the home page's infinite-scroll. Returns one cursor PAGE of
// FeedItems with myVote pre-populated for the given voterId, plus the opaque `nextCursor` for the
// next page (null at end of feed) and the echoed `sort` so a client can detect a mode switch.
//
// [LAW:single-enforcer] getFeedPage is the single feed reader — no parallel query path here. The
// homelab voter reads only `items` (one page is plenty for its judging pass); the browser client
// follows `nextCursor`. voterId flows in as a query param (agents) or is absent (anonymous fetch).
// sort/window/cursor/limit are read from the query string; a missing/garbage sort folds to the
// default, and a garbage/wrong-mode cursor degrades to page 1 inside getFeedPage. No cookie parsing;
// no side effects.
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const voterId = url.searchParams.get("voterId") ?? undefined
  const sort = parseSortMode(url.searchParams.get("sort"), url.searchParams.get("window")) ?? defaultSortMode
  const cursor = url.searchParams.get("cursor")
  const limitParam = url.searchParams.get("limit")
  const limit = limitParam !== null ? Number(limitParam) : undefined
  const { items, nextCursor } = await getFeedPage(context.cloudflare.env, { sort, voterId, limit, cursor })
  return Response.json({ items, nextCursor, sort })
}
