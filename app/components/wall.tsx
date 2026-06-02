import type { FeedItem } from "~/lib/domain"
import { PostCard } from "~/components/post-card"

// [LAW:dataflow-not-control-flow] Tile prominence is a FOLD over standing, never a
// mode. The feed arrives already ranked upstream, so a slop's position IS its
// standing in the current ordering. The wall partitions that ranking into the
// crowned head — the single most-blessed slop, hung large and gilt as the focal
// relic — and the body, packed tight as surrounding studies. The data decides which
// slop is big; this layout toggles no "featured" flag.
//
// [LAW:types-are-the-program] The two arms below are the ONLY states the partition
// can produce: an empty feed (no relic, no studies) or a crowned wall (a relic with
// its studies). A focal-less wall that still holds studies is unrepresentable — so
// the relic branch reads its focal as present, with no guard defending an impossible
// state.
type WallLayout =
  | { focal: null; studies: readonly [] }
  | { focal: FeedItem; studies: FeedItem[] }

function partitionWall(items: FeedItem[]): WallLayout {
  const [focal, ...studies] = items
  return focal === undefined ? { focal: null, studies: [] } : { focal, studies }
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
// [LAW:locality-or-seam] The wall is a layout seam only — it forwards each renderable
// to the card as one opaque value, so a change to what a card shows touches the card
// alone and never the wall.
export function Wall({ items }: { items: FeedItem[] }) {
  const layout = partitionWall(items)
  // [LAW:types-are-the-program] The empty arm is a narrowed branch, not a sentinel
  // check: an empty feed has no wall to hang, and the page owns the "nobody's here"
  // copy. Past this line the focal is typed present.
  if (layout.focal === null) return null
  const { focal, studies } = layout
  return (
    <ul className="columns-1 gap-4 sm:columns-2 lg:columns-3 2xl:columns-4">
      {/* The crowned relic — the wall gives it two of its three marks of dominance:
          SIZE (full-wall column-span + the wide measure) and the room's CENTER-LIGHT
          (the gilt glow it sits in). The third mark — the grand aged-gilt FRAME — is the
          card's: the card renders the grand frame for the crowned level. [LAW:single-enforcer]
          framing is the card's alone; the wall must not ring the focal itself or the crown
          wears two frames. [LAW:one-source-of-truth] the wall owns layout + light; the card
          owns the frame. */}
      <li key={focal.post.id} className="mb-4 block [column-span:all]">
        <div className="mx-auto max-w-3xl rounded-lg shadow-[0_0_44px_-10px_rgb(202_164_74/0.4)]">
          <PostCard {...focal} frame="crowned" />
        </div>
      </li>
      {studies.map((item) => (
        <li key={item.post.id} className="mb-4 block break-inside-avoid">
          <PostCard {...item} frame="study" />
        </li>
      ))}
    </ul>
  )
}
