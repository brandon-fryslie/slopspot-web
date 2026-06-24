import type { Route } from "./+types/api.hum"
import { getFeedPage } from "~/db/feed"
import { getPulse } from "~/db/pulse"
import { latestCrownedPostId } from "~/db/crowns"
import { newestSortMode } from "~/lib/sort-mode"
import { readVoterId } from "~/lib/voter-cookie"

// THE HUM POLL — the city's live snapshot (the-haunted-gallery.md move F). The client polls this
// slowly (~30s, visibility- and reduced-motion-gated, backing off when idle — see useHum) to keep
// the room humming: new slop arriving on the wall, the Pulse breathing, the gold settling.
//
// [LAW:one-source-of-truth] Every field is read through the SAME readers the home loader uses, so
// the live view can never drift from a freshly-navigated page: getFeedPage for the newest page-0
// (CD ruling q1 — "newest/page-0 only", so arrivals are the firehose's real output regardless of
// the wall's sort), getPulse for the heartbeat, latestCrownedPostId for the cheap rite state the
// gold-settle rides on (q5 — "free if the page-0 poll already carries it").
//
// [LAW:single-enforcer] The viewer is resolved here exactly as /api/feed and the home loader do —
// the anonymous voter cookie — so an arrival tile shows the human's own myVote. Read-only: no
// Set-Cookie, no cache headers (per-viewer identity, no shared-cache hazard), no side effects.
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const voterId = readVoterId(request)
  // [LAW:no-ambient-temporal-coupling] One clock read at this boundary, threaded into getPulse —
  // the only place this request reads the wall clock.
  const nowMs = Date.now()
  const [page, pulse, crownedPostId] = await Promise.all([
    getFeedPage(env, { sort: newestSortMode, voterId }),
    getPulse(env, nowMs),
    latestCrownedPostId(env),
  ])
  return Response.json({ items: page.items, pulse, crownedPostId })
}
