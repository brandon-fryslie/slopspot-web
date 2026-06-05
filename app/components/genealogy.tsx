import { Link } from "react-router"
import type { Genealogy, GenealogyNode, Media } from "~/lib/domain"

// [LAW:dataflow-not-control-flow] The family tree renders by the DATA the read boundary derived
// from the lineage_edges DAG — two trees of thumbnails, ancestry up and offspring down. A founder
// with no offspring carries two empty arrays and this whole section does not appear; there is no
// `isLineage` flag and no "no lineage yet" apology (the quiet is correct). Each branch and each
// node renders by the length of its array, never a count branch in the markup.
//
// [LAW:single-enforcer] The per-post slice of the grand Slop Genome view lives HERE; the card
// (post-card.tsx) renders the focal slop and its terse forked-from badge, this hangs the tree
// beside it on the permalink. The card stays feed-safe (the feed never pays for this read).
export function GenealogyView({ genealogy }: { genealogy: Genealogy }) {
  if (genealogy.ancestors.length === 0 && genealogy.offspring.length === 0) return null
  return (
    <section className="mt-6 overflow-hidden rounded-lg border border-votive/12 bg-panel px-3 py-3">
      <h2 className="font-terminal text-[10px] uppercase tracking-widest text-ash/70">genealogy</h2>
      {/* Branch returns null on an empty side, so a post with only ancestry (or only offspring)
          shows just the branch it has — the presence of nodes is the discriminator. */}
      <Branch label="ancestry" nodes={genealogy.ancestors} />
      <Branch label="offspring" nodes={genealogy.offspring} />
    </section>
  )
}

function Branch({ label, nodes }: { label: string; nodes: readonly GenealogyNode[] }) {
  if (nodes.length === 0) return null
  return (
    <div className="mt-2">
      <div className="font-terminal text-[10px] uppercase tracking-wider text-votive/50">{label}</div>
      <NodeList nodes={nodes} />
    </div>
  )
}

// The recursive tree: each node is a clickable thumbnail; its kin (parents going up, children
// going down) nest under it behind a rule, the same thread treatment the Exchange uses. The
// recursion follows the data shape — kin is empty at a founder/leaf, so the nested block simply
// does not render. [LAW:one-type-per-behavior] one list renderer serves every depth.
function NodeList({ nodes }: { nodes: readonly GenealogyNode[] }) {
  return (
    <ul className="mt-1 flex flex-col gap-1">
      {nodes.map((n) => (
        <li key={n.postId}>
          <NodeTile node={n} />
          {n.kin.length > 0 && (
            <div className="ml-4 border-l border-votive/15 pl-2">
              <NodeList nodes={n.kin} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

// [LAW:one-source-of-truth] React Router's <Link> is the in-app navigation primitive — the same
// reveal path the byline and forked-from badge use. The node links to its own permalink, so the
// tree is the navigable lineage the ticket asks for: click an ancestor or descendant to land on it.
function NodeTile({ node }: { node: GenealogyNode }) {
  return (
    <Link
      to={`/p/${node.postId}`}
      className="inline-flex items-center gap-2 rounded border border-votive/10 bg-base/40 px-1.5 py-1 transition hover:border-votive/30 hover:bg-bone/[0.04]"
    >
      <Thumb media={node.thumbnail} />
      <span className="font-terminal text-[11px] text-votive/80">p:{node.postId.slice(0, 8)}</span>
    </Link>
  )
}

// [LAW:dataflow-not-control-flow] The displayable source is computed ONCE from the node's
// phenotype: an image's url, or null for a node with no image (not-yet-rendered, or non-image
// media that has no thumbnail). The single value decides tile-vs-glyph — no chain of guards.
function Thumb({ media }: { media: Media | null }) {
  const src = media?.kind === "image" ? media.url : null
  return src === null ? (
    <span
      aria-hidden
      className="grid h-10 w-10 place-items-center rounded-sm bg-bone/5 font-terminal text-ash"
    >
      ▢
    </span>
  ) : (
    <img
      src={src}
      alt=""
      loading="lazy"
      className="h-10 w-10 rounded-sm bg-bone/5 object-cover"
    />
  )
}
