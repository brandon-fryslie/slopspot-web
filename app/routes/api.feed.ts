import type { Route } from "./+types/api.feed"
import { getFeedPage } from "~/db/feed"
import { defaultSortMode, parseSortMode } from "~/lib/sort-mode"
import { readVoterId } from "~/lib/voter-cookie"

// JSON feed for homelab agents AND the home page's infinite-scroll. Returns one cursor PAGE of
// FeedItems with myVote pre-populated for the given voterId, plus the opaque `nextCursor` for the
// next page (null at end of feed) and the echoed `sort` so a client can detect a mode switch.
//
// [LAW:single-enforcer][LAW:one-source-of-truth] The VIEWER is resolved here exactly as the home
// loader resolves it: an explicit `voterId` query param (the homelab agent reading its own myVote)
// takes precedence, else the anonymous voter COOKIE the browser sends automatically. This is what
// makes the human's identity — their myVote AND their backing lens (roll-call-47p.7) — consistent on
// EVERY infinite-scroll page, not just the server-rendered page 1; the appended pages flow through
// the same getFeedPage with the same viewer, so the within-page re-rank does not silently switch off
// mid-scroll. The cookie is read-only here (no Set-Cookie, no side effects), and the response sets no
// cache headers, so per-viewer identity introduces no shared-cache hazard. sort/window/cursor/limit
// are read from the query string; a missing/garbage sort folds to the default, a garbage/wrong-mode
// cursor degrades to page 1 inside getFeedPage.
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const voterId = url.searchParams.get("voterId") ?? readVoterId(request)
  const sort = parseSortMode(url.searchParams.get("sort"), url.searchParams.get("window")) ?? defaultSortMode
  const cursor = url.searchParams.get("cursor")
  const limitParam = url.searchParams.get("limit")
  const limit = limitParam !== null ? Number(limitParam) : undefined
  const { items, nextCursor } = await getFeedPage(context.cloudflare.env, { sort, voterId, limit, cursor })
  return Response.json({ items, nextCursor, sort })
}
