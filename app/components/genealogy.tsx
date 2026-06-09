import { Link } from "react-router"
import type { Dynasty, Genealogy, GenealogyNode, Media } from "~/lib/domain"
import type { DriftEntry, DynastyChronicle, FounderHonor, InbredEntry } from "~/db/dynasty-chronicle"
import type { Utterance } from "~/lib/voice"

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

// [LAW:one-type-per-behavior] The whole-dynasty view (slopspot-genome-p6z.2) — the founder-rooted
// forest, rendered with the SAME recursive NodeList the per-post tree uses (a founder is just a
// GenealogyNode whose kin is its descendant tree). [LAW:dataflow-not-control-flow] the forest renders
// by the founders ARRAY: empty → nothing (a post with no resolvable dynasty), each founder → one rooted
// tree. A bred post belongs to multiple bloodlines, so multiple founder trees is the honest forest.
export function DynastyView({ dynasty }: { dynasty: Dynasty }) {
  if (dynasty.founders.length === 0) return null
  return (
    <section className="overflow-hidden rounded-lg border border-votive/12 bg-panel px-3 py-3">
      <h1 className="font-terminal text-[10px] uppercase tracking-widest text-ash/70">dynasty</h1>
      {/* Each founder roots its whole bloodline; NodeList renders the founder tile + its descendant
          tree recursively, the same thread treatment the per-post offspring branch uses. */}
      <NodeList nodes={dynasty.founders} />
    </section>
  )
}

// [LAW:dataflow-not-control-flow] The bloodline's long-game read-out (slopspot-genome-p6z.6) — the SURFACE
// of the genealogy folds beside the thumbnail forest. Three derived sections render by the LENGTH of their
// arrays: who founded the line (honored, Relic candidates), how far each generation has drifted (the
// austere→baroque / clean→cursed wander you can scroll), and which crosses fell back into their own kin
// (the Gremlin's verdict). An empty chronicle (a degenerate bloodline) renders nothing — absence is the
// discriminator, never an `isDynasty` flag.
export function DynastyChronicleView({ chronicle }: { chronicle: DynastyChronicle }) {
  if (
    chronicle.founders.length === 0 &&
    chronicle.drift.length === 0 &&
    chronicle.inbred.length === 0
  ) {
    return null
  }
  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-votive/12 bg-panel px-3 py-3">
      <h2 className="font-terminal text-[10px] uppercase tracking-widest text-ash/70">the long game</h2>
      <FoundersHonored founders={chronicle.founders} />
      <DriftLine drift={chronicle.drift} />
      <InbreedingNotices inbred={chronicle.inbred} />
    </section>
  )
}

// [LAW:dataflow-not-control-flow] The founders honored — each root of the bloodline, marked and weighted by
// the line it rooted, linking to the Calendar of Saints where Relics are venerated (a founder is a Wednesday
// Relic candidate). Empty founders → nothing, by array length.
function FoundersHonored({ founders }: { founders: readonly FounderHonor[] }) {
  if (founders.length === 0) return null
  return (
    <div className="mt-2">
      <div className="font-terminal text-[10px] uppercase tracking-wider text-votive/50">founders</div>
      <ul className="mt-1 flex flex-col gap-1">
        {founders.map((f) => (
          <li key={f.postId} className="flex items-center gap-2 font-terminal text-[11px]">
            <span className="rounded-sm border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-gold">
              ✦ founder
            </span>
            <Link to={`/p/${f.postId}`} className="text-votive/80 hover:text-votive">
              p:{f.postId.slice(0, 8)}
            </Link>
            <span className="text-ash/70">rooted {f.descendantCount}</span>
            <Link to="/saints" className="text-ash hover:text-gold/80" title="the Calendar of Saints — where Relics are venerated">
              relic candidate →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

// [LAW:dataflow-not-control-flow] Drift you can scroll — every generation in founder→leaf order, each showing
// how far it has wandered from the root(s) it descends from. The speciation verdict (a new species, drifted
// past the threshold from EVERY founder) is the VALUE that selects the tag; the per-founder distances are the
// scrollable detail. A founder reads gen 0, distance 0 — the honest baseline, no special case.
function DriftLine({ drift }: { drift: readonly DriftEntry[] }) {
  if (drift.length === 0) return null
  return (
    <div className="mt-3">
      <div className="font-terminal text-[10px] uppercase tracking-wider text-votive/50">drift</div>
      <ol className="mt-1 flex flex-col gap-1">
        {drift.map((d) => (
          <li key={d.postId} className="flex flex-wrap items-center gap-2 font-terminal text-[11px]">
            <span className="text-ash/60">gen {d.depth}</span>
            <Link to={`/p/${d.postId}`} className="text-votive/80 hover:text-votive">
              p:{d.postId.slice(0, 8)}
            </Link>
            {d.speciation.isNewSpecies && (
              <span className="rounded-sm border border-profane/40 bg-profane/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-profane/90">
                new species
              </span>
            )}
            <span className="text-ash/70">
              {d.speciation.founders
                .map((f) => `Δgenes ${f.distance.geneMismatches} · Δtraits ${f.distance.traitDrift.toFixed(1)}`)
                .join("  /  ")}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// [LAW:dataflow-not-control-flow] The inbreeding notices — each flagged cross with the Gremlin's verdict. The
// utterance VALUE selects what renders: a spoke line is the Gremlin's barb; a withheld one (the persona row
// absent) shows the bare flag without a fabricated line. Empty inbred → nothing.
function InbreedingNotices({ inbred }: { inbred: readonly InbredEntry[] }) {
  if (inbred.length === 0) return null
  return (
    <div className="mt-3">
      <div className="font-terminal text-[10px] uppercase tracking-wider text-profane/60">inbreeding</div>
      <ul className="mt-1 flex flex-col gap-2">
        {inbred.map((e) => (
          <li key={e.postId} className="font-terminal text-[11px]">
            <div className="flex items-center gap-2">
              <span className="rounded-sm border border-profane/40 bg-profane/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.2em] text-profane/90">
                ⚠ inbred
              </span>
              <Link to={`/p/${e.postId}`} className="text-votive/80 hover:text-votive">
                p:{e.postId.slice(0, 8)}
              </Link>
            </div>
            <GremlinLine remark={e.remark} />
          </li>
        ))}
      </ul>
    </div>
  )
}

// [LAW:dataflow-not-control-flow] The Gremlin's verdict, rendered by the Utterance union — spoke → the barb;
// withheld → nothing (an unavailable machine leaves the flag to speak for itself). Total over the union.
function GremlinLine({ remark }: { remark: Utterance }) {
  switch (remark.kind) {
    case "spoke":
      return <p className="mt-1 pl-1 text-ash/80 italic">“{remark.text}” — the Gremlin</p>
    case "withheld":
      return null
  }
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
