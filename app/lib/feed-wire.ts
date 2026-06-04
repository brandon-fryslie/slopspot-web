// [LAW:single-enforcer] The one place that turns a /api/feed JSON row back into a domain FeedItem.
// /api/feed is a resource route (Response.json), so Dates cross the wire as ISO STRINGS — unlike the
// home loader, whose RR7 turbo-stream encoding revives them. This module is the INVERSE of that
// serialization: the wire→domain boundary for client-fetched pages (home.tsx's infinite scroll). A
// raw `fetch().json()` cannot revive Dates, so without this an appended item is a string-dated
// impostor and PostCard's relativeTime(post.createdAt).getTime() throws (caught in browser
// verification, not the server suite — see ff1bdb8).
//
// [LAW:types-are-the-program] WireFeedItem states the strongest true theorem about a parsed feed
// row: it is a FeedItem EXCEPT post.createdAt is a string. createdAt is the only Date the rendered
// card consumes; the GenerationStatus dates nested in content are not read client-side, so they are
// left as the wire carried them rather than walking the Content union to revive fields nobody reads.

import type { FeedItem } from '~/lib/domain'

export type WireFeedItem = Omit<FeedItem, 'post'> & {
  post: Omit<FeedItem['post'], 'createdAt'> & { createdAt: string }
}

// Revive the one Date the domain (and the card) requires, so the result is a true FeedItem.
export function reviveFeedItem(wire: WireFeedItem): FeedItem {
  return { ...wire, post: { ...wire.post, createdAt: new Date(wire.post.createdAt) } }
}
