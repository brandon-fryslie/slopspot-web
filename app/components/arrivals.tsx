import type { FeedItem } from "~/lib/domain"
import { PostCard } from "~/components/post-card"

// THE ARRIVALS — the firehose feeding the wall, made visible (the-haunted-gallery.md move F). New
// slop the city made WHILE you watched, settling in at the top of the room.
//
// [FRAMING:representation] Rendered ABOVE the ranked wall as STUDY tiles — never the focal. The
// wall's focal MEANS "the single loudest-now relic"; an arrival is the NEWEST thing, not the
// loudest, so it must not wear that slot or the focal would lie. Transient: a navigation re-ranks
// the whole feed and these dissolve into the true ordering.
//
// [LAW:no-ambient-temporal-coupling] The fade-settle is CSS-owned (.slop-arriving, app.css) and
// fires once on mount, like the crown settling — no JS clock, and the @media reduced-motion query
// turns it off. The hook only ever hands this NON-EMPTY arrivals near the top, where the visitor is
// there to watch them land.
export function Arrivals({ items }: { items: FeedItem[] }) {
  // [LAW:dataflow-not-control-flow] No arrivals, no strip — the empty list renders nothing, never
  // an empty rail above the wall.
  if (items.length === 0) return null
  return (
    <ul className="mb-4 columns-1 gap-4 sm:columns-2 lg:columns-3 2xl:columns-4">
      {items.map((item) => (
        <li key={item.post.id} className="slop-arriving mb-4 block break-inside-avoid">
          <PostCard {...item} frame={{ kind: "study" }} />
        </li>
      ))}
    </ul>
  )
}
