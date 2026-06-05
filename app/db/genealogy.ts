// [LAW:single-enforcer] Narrow per-post genealogy read — the family-tree slice for a single
// permalink. Runs targeted queries (ancestors iteratively, direct children, batch thumbnail
// resolution) rather than materializing the whole DAG. getLineageDag (genome-dag.ts) loads the
// full corpus for whole-DAG folds (dynasty/speciation/founders); this file is the scoped cousin
// for the per-post genealogy VIEW.
//
// [LAW:one-source-of-truth] Ancestry is derived from lineage_edges alone — no ancestry column.
// The same one-source-one-fold pattern as score=SUM(votes) and founder=no-parent-edges.
// [LAW:one-way-deps] Pure DB reads. The genealogy component consumes the returned types; no
// domain logic lives here.

import { eq, inArray } from 'drizzle-orm'
import { db } from '~/db/client'
import { generations, lineageEdges } from '~/db/schema'
import { PostId, type GenealogyChild, type LineageNode, type PostGenealogy } from '~/lib/domain'

// Parse the Media url out of the stored outputJson without importing the full Media schema.
// We only need the url — the domain Media union is the authoritative home for the full shape.
function parseThumbnailUrl(outputJson: string | null): string | null {
  if (!outputJson) return null
  try {
    const parsed = JSON.parse(outputJson) as { url?: unknown }
    return typeof parsed.url === 'string' ? parsed.url : null
  } catch {
    return null
  }
}

function lineageKindFromParentCount(n: number): 'founder' | 'single' | 'bred' {
  if (n === 0) return 'founder'
  if (n === 1) return 'single'
  return 'bred'
}

// [LAW:dataflow-not-control-flow] Iterative BFS over parent edges: the queue starts with
// `postId` and expands until every reachable ancestor is loaded. No cycle guard needed for
// safety (the DAG is acyclic by construction) but the `seen` set keeps it O(nodes) not O(paths).
async function collectAncestorEdges(
  database: ReturnType<typeof db>,
  startId: string,
): Promise<Map<string, string[]>> {
  const parentEdges = new Map<string, string[]>()
  const seen = new Set<string>([startId])
  let frontier = [startId]
  while (frontier.length > 0) {
    const rows = await database
      .select({ child: lineageEdges.childGenomeId, parent: lineageEdges.parentGenomeId })
      .from(lineageEdges)
      .where(inArray(lineageEdges.childGenomeId, frontier))
    const nextFrontier: string[] = []
    for (const row of rows) {
      const ps = parentEdges.get(row.child) ?? []
      ps.push(row.parent)
      parentEdges.set(row.child, ps)
      if (!seen.has(row.parent)) {
        seen.add(row.parent)
        nextFrontier.push(row.parent)
      }
    }
    frontier = nextFrontier
  }
  return parentEdges
}

// [LAW:types-are-the-program] buildNode produces a LineageNode whose discriminator exactly
// matches the edge count — the same fold toLineage() in genome-dag.ts applies per row, here
// extended to carry the recursive resolved node. Memoized so each id is built once (DAG
// diamonds would otherwise duplicate work, not produce cycles — but dedup is still correct).
function buildAncestryNode(
  id: string,
  parentEdges: Map<string, string[]>,
  thumbnails: Map<string, string | null>,
  memo: Map<string, LineageNode>,
): LineageNode {
  const cached = memo.get(id)
  if (cached) return cached
  const thumbnailUrl = thumbnails.get(id) ?? null
  const parents = parentEdges.get(id) ?? []
  let node: LineageNode
  if (parents.length === 0) {
    node = { kind: 'founder', id: PostId(id), thumbnailUrl }
  } else if (parents.length === 1) {
    node = {
      kind: 'single',
      id: PostId(id),
      thumbnailUrl,
      parent: buildAncestryNode(parents[0]!, parentEdges, thumbnails, memo),
    }
  } else {
    node = {
      kind: 'bred',
      id: PostId(id),
      thumbnailUrl,
      parents: [
        buildAncestryNode(parents[0]!, parentEdges, thumbnails, memo),
        buildAncestryNode(parents[1]!, parentEdges, thumbnails, memo),
      ],
    }
  }
  memo.set(id, node)
  return node
}

// Returns null for non-generation posts (uploads and found-links have no genome / no lineage).
// [LAW:dataflow-not-control-flow] null degrades the permalink render to "no genealogy panel"
// without a branch in the route; the component renders by data presence, not a mode flag.
export async function getPostGenealogy(env: Env, postId: PostId): Promise<PostGenealogy | null> {
  const database = db(env)

  // Gate: only generation posts have lineage.
  const [selfGen] = await database
    .select({ status: generations.status })
    .from(generations)
    .where(eq(generations.postId, postId))
    .limit(1)
  if (!selfGen) return null

  // Collect all ancestor edges (parents + grandparents + ... up to founders)
  const parentEdges = await collectAncestorEdges(database, postId)

  // Collect direct children of this post (edges pointing TO this post as parent)
  const childRows = await database
    .select({ child: lineageEdges.childGenomeId })
    .from(lineageEdges)
    .where(eq(lineageEdges.parentGenomeId, postId))
  const childIds = [...new Set(childRows.map((r) => r.child))]

  // For each child, determine lineageKind from their TOTAL parent count (not just
  // the edge to this post — a bred child has two parents, only one is this post).
  const childParentCounts = new Map<string, number>()
  if (childIds.length > 0) {
    const allChildParentEdges = await database
      .select({ child: lineageEdges.childGenomeId })
      .from(lineageEdges)
      .where(inArray(lineageEdges.childGenomeId, childIds))
    for (const row of allChildParentEdges) {
      childParentCounts.set(row.child, (childParentCounts.get(row.child) ?? 0) + 1)
    }
  }

  // Batch-load thumbnail URLs for all ancestors + self + children
  const ancestorIds = new Set<string>([postId])
  for (const [child] of parentEdges) ancestorIds.add(child)
  for (const [, parents] of parentEdges) for (const p of parents) ancestorIds.add(p)
  const allIds = [...ancestorIds, ...childIds]

  const genRows =
    allIds.length === 0
      ? []
      : await database
          .select({ postId: generations.postId, outputJson: generations.outputJson, status: generations.status })
          .from(generations)
          .where(inArray(generations.postId, allIds))

  const thumbnails = new Map<string, string | null>()
  for (const row of genRows) {
    thumbnails.set(
      row.postId,
      row.status === 'succeeded' ? parseThumbnailUrl(row.outputJson) : null,
    )
  }

  const memo = new Map<string, LineageNode>()
  const self = buildAncestryNode(postId, parentEdges, thumbnails, memo)

  const children: GenealogyChild[] = childIds.map((childId) => ({
    id: PostId(childId),
    thumbnailUrl: thumbnails.get(childId) ?? null,
    lineageKind: lineageKindFromParentCount(childParentCounts.get(childId) ?? 0),
  }))

  return { self, children }
}
