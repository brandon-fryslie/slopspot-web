// [LAW:types-are-the-program] Visual genealogy for a single slop permalink — the per-post
// slice of the lineage DAG rendered as a family tree of thumbnails. Ancestors above the post,
// offspring below. The component is purely a rendering fold over PostGenealogy; all derivation
// happens at the read boundary (app/db/genealogy.ts).
//
// [LAW:dataflow-not-control-flow] The render is unconditional — empty ancestors or children
// collapse those sections to nothing (the array's length is the only discriminator). No
// `if (hasParents)` mode flags; the data decides what is visible.

import { Link } from 'react-router'
import type { GenealogyChild, LineageNode, PostGenealogy, PostId } from '~/lib/domain'

// A slim node in the visual tree — thumbnail image + post link.
// [LAW:types-are-the-program] `thumbnailUrl` is nullable: a generation that hasn't yet succeeded
// (or an upload/found that slipped through) shows a placeholder rather than crashing. The absence
// is data, not an error to guard against.
function GenealogyThumbnail({
  id,
  thumbnailUrl,
  label,
  highlight = false,
}: {
  id: PostId
  thumbnailUrl: string | null
  label?: string
  highlight?: boolean
}) {
  return (
    <Link
      to={`/p/${id}`}
      className={`group flex flex-col items-center gap-1 ${highlight ? 'pointer-events-none' : ''}`}
      title={`p:${id.slice(0, 8)}`}
    >
      <div
        className={`
          relative h-16 w-16 overflow-hidden rounded border transition-colors
          ${highlight
            ? 'border-votive/60 ring-1 ring-votive/30'
            : 'border-white/10 group-hover:border-votive/40'
          }
        `}
      >
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={`p:${id.slice(0, 8)}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-panel">
            <span className="font-terminal text-xs text-white/20">?</span>
          </div>
        )}
      </div>
      {label && (
        <span className="font-terminal text-[10px] text-white/30">{label}</span>
      )}
    </Link>
  )
}

// [LAW:dataflow-not-control-flow] Ancestry rows are collected by walking UP the LineageNode
// tree from the post itself. Each call peels one level and recurses. An empty `parents` list
// (founder node) returns an empty array — no explicit base-case branch on kind.
type AncestorRow = { rowLabel: string; nodes: Array<{ id: PostId; thumbnailUrl: string | null }> }

function collectAncestorRows(node: LineageNode, depth = 0, maxDepth = 4): AncestorRow[] {
  if (node.kind === 'founder') return []
  const parents = node.kind === 'single' ? [node.parent] : [...node.parents]
  const rowLabel = depth === 0
    ? (node.kind === 'single' ? 'parent' : 'bred from')
    : depth === 1 ? 'grandparent' : 'ancestor'
  const thisRow: AncestorRow = {
    rowLabel,
    nodes: parents.map((p) => ({ id: p.id, thumbnailUrl: p.thumbnailUrl })),
  }
  // Recurse into parents — collect their rows above
  if (depth < maxDepth) {
    const upperRows = parents.flatMap((p) => collectAncestorRows(p, depth + 1, maxDepth))
    // Deduplicate by id across all upper rows (diamond lineages can share an ancestor)
    const seenIds = new Set<string>()
    const deduped = upperRows.map((row) => ({
      ...row,
      nodes: row.nodes.filter((n) => {
        if (seenIds.has(n.id)) return false
        seenIds.add(n.id)
        return true
      }),
    })).filter((row) => row.nodes.length > 0)
    return [...deduped, thisRow]
  }
  return [thisRow]
}

// [LAW:types-are-the-program] The connector between rows — a visual edge in the DAG.
// Rendered as a centred vertical line so the eye traces the inheritance path upward.
function AncestryConnector() {
  return (
    <div className="flex justify-center py-0.5">
      <div className="h-4 w-px bg-white/15" />
    </div>
  )
}

// [LAW:one-source-of-truth] The verb that labels a child's relationship to its parent — the
// same vocabulary ForkedFromBadge uses in the post header. Exhaustive switch keeps these two
// surfaces in lock-step without a shared constant; if a new lineageKind is added, both fail
// to compile.
function childRelationLabel(kind: GenealogyChild['lineageKind']): string {
  switch (kind) {
    case 'founder':
      return 'spontaneous'  // shouldn't reach here in practice — a child always has a parent
    case 'single':
      return 'forked'
    case 'bred':
      return 'bred'
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

// Entry point: renders ancestry rows above (oldest at top), offspring below.
// null genealogy → nothing rendered (non-generation posts, or data still loading).
export function PostLineageTree({ genealogy }: { genealogy: PostGenealogy | null }) {
  if (genealogy === null) return null

  const { self, children } = genealogy
  const ancestorRows = collectAncestorRows(self)
  const hasAncestors = ancestorRows.length > 0
  const hasChildren = children.length > 0

  if (!hasAncestors && !hasChildren) return null

  return (
    <section className="mt-6 rounded-lg border border-white/8 bg-panel/60 p-4">
      <h3 className="mb-4 font-terminal text-xs uppercase tracking-[0.2em] text-white/30">
        lineage
      </h3>

      {/* Ancestry: oldest ancestors at top, immediate parents closest to divider */}
      {hasAncestors && (
        <div className="mb-4">
          {ancestorRows.map((row, i) => (
            <div key={`ancestor-row-${i}`}>
              <div className="mb-1 flex justify-center">
                <span className="font-terminal text-[10px] uppercase tracking-widest text-white/20">
                  {row.rowLabel}
                </span>
              </div>
              <div className="flex justify-center gap-3">
                {row.nodes.map((n) => (
                  <GenealogyThumbnail key={n.id} id={n.id} thumbnailUrl={n.thumbnailUrl} />
                ))}
              </div>
              <AncestryConnector />
            </div>
          ))}
          {/* The current post itself — highlighted as the focal node */}
          <div className="flex justify-center">
            <GenealogyThumbnail
              id={self.id}
              thumbnailUrl={self.thumbnailUrl}
              label="this slop"
              highlight
            />
          </div>
        </div>
      )}

      {/* Divider between ancestry and offspring */}
      {hasAncestors && hasChildren && (
        <div className="my-4 border-t border-white/8" />
      )}

      {/* Offspring: posts bred or forked FROM this post */}
      {hasChildren && (
        <div>
          {!hasAncestors && (
            <div className="mb-2 flex justify-center">
              <span className="font-terminal text-xs text-white/20">this slop</span>
            </div>
          )}
          <AncestryConnector />
          <div className="mb-1 flex justify-center">
            <span className="font-terminal text-[10px] uppercase tracking-widest text-white/20">
              offspring
            </span>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {children.map((child) => (
              <GenealogyThumbnail
                key={child.id}
                id={child.id}
                thumbnailUrl={child.thumbnailUrl}
                label={childRelationLabel(child.lineageKind)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
