import type { FeedItem } from "~/lib/domain"
import { PostCard } from "~/components/post-card"

// [LAW:dataflow-not-control-flow] Tile prominence is a FOLD over standing, never a
// mode. The feed arrives already ranked by the read enforcer (feed.ts), so a slop's
// position IS its standing in the current ordering. The wall partitions that ranking
// into the crowned head — the single most-blessed slop, hung large and gilt as the
// focal relic — and the body, packed tight as surrounding studies. A pure partition
// by position: the data decides which slop is big; this layout toggles no "featured"
// flag. The empty feed folds to {focal: null, studies: []}, so the wall renders
// nothing rather than special-casing emptiness — the page owns the "nobody's here" copy.
type WallLayout = { focal: FeedItem | null; studies: FeedItem[] }

function partitionWall(items: FeedItem[]): WallLayout {
  const [focal = null, ...studies] = items
  return { focal, studies }
}

// THE WALL — kill the void. The feed stops being a phone-width column in a black
// void and becomes a dense, edge-to-edge mosaic that fills the room (the-wall.md,
// the-haunted-gallery.md move A). Density is the thesis: the layout SHOWS abundance.
//
// [LAW:locality-or-seam] The mechanism is CSS multi-column, not CSS grid. The lit
// card is variable-height (image at native aspect + placard + verdict + votes +
// comments), and only column-masonry packs variable-height tiles with no vertical
// gaps — a grid would align every row to its tallest cell and re-open the dead space
// the void is made of. Cards flow into balanced columns; the gallery packs itself.
//
// The card bones and the feed data are untouched: a FeedItem IS a PostCard's prop
// shape, spread across the boundary as one value. New renderable fields reach the
// card without editing the wall.
export function Wall({ items }: { items: FeedItem[] }) {
  const { focal, studies } = partitionWall(items)
  return (
    <ul className="columns-1 gap-4 sm:columns-2 lg:columns-3 2xl:columns-4">
      {focal !== null && (
        // The crowned relic — hung large across the full wall, lit in gilt. Size AND
        // gold together read "most blessed" by data alone: the gilt token is the
        // city's reserved mark for the crowned (the-threshold.md). The studies pack
        // beneath it; the relic gets the room's center light.
        <li key={focal.post.id} className="mb-4 block [column-span:all]">
          <div className="mx-auto max-w-3xl rounded-lg ring-1 ring-gilt/45 shadow-[0_0_44px_-10px_rgb(202_164_74/0.4)]">
            <PostCard {...focal} />
          </div>
        </li>
      )}
      {studies.map((item) => (
        // break-inside-avoid keeps a card whole within its column — a slop never
        // splits across the gutter.
        <li key={item.post.id} className="mb-4 block break-inside-avoid">
          <PostCard {...item} />
        </li>
      ))}
    </ul>
  )
}
