// [LAW:single-enforcer] The per-post genealogy read — the NARROW slice the permalink hangs,
// sibling to genome-dag.ts's whole-DAG snapshot. The grand Slop Genome view folds every genome
// (genome-dag → genealogy.ts); this folds only the subgraph reachable from ONE post, so it never
// loads the heavy generations table wholesale. The lineage_edges table is the skinny DAG spine
// (two id columns), so one read of it + one read of ONLY the slice's phenotypes is lighter than
// either the whole-DAG load or N recursive round-trips. It reuses the lineage SOURCE (the edges),
// not the genealogy folds — a thumbnail tree is its own read-model (a Genome carries no Media).
//
// [LAW:one-way-deps] A db-layer read returning the domain's Genealogy projection. The pure
// traversal is in-memory over the adjacency maps built here; no feed.ts surface is touched.

import { asc, inArray } from 'drizzle-orm'
import { db } from '~/db/client'
import { generations, lineageEdges } from '~/db/schema'
import { PostId, type Dynasty, type Genealogy, type GenealogyNode, type Media } from '~/lib/domain'

// D1 binds one parameter per id, capped at 100 per statement. A dynasty's slice can exceed that,
// so the phenotype read is chunked — never silently truncated. [LAW:no-silent-fallbacks]
const PARAM_CAP = 90

// [LAW:no-defensive-null-guards] A succeeded generation's output_json is NOT NULL by the
// generations_status_shape CHECK; a null here is storage corruption, so it fails loud rather than
// laundering to a blank thumbnail. JSON.parse is the structural check (matching feed.ts's trusted
// boundary deserialize — the shape is trusted the way params_json is).
function parsePhenotype(raw: string | null, id: string): Media {
  if (raw === null) throw new Error(`genealogy: succeeded node ${id} has null output_json`)
  try {
    return JSON.parse(raw) as Media
  } catch (err) {
    throw new Error(`genealogy: malformed output_json for ${id}`, { cause: err })
  }
}

// Every node reachable by following `adj` from `start`, excluding `start`. Deduped, so a diamond
// (a node reached via two paths in a breeding DAG) is collected once and the walk terminates.
function reachable(adj: ReadonlyMap<string, string[]>, start: string): string[] {
  const out: string[] = []
  const seen = new Set<string>([start])
  const stack = [...(adj.get(start) ?? [])]
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    out.push(cur)
    for (const n of adj.get(cur) ?? []) stack.push(n)
  }
  return out
}

// [LAW:one-type-per-behavior] Siblings are a PEER relation, not a direction in the tree — the
// same-parent peers of `start`, sorted for a stable list. A sibling shares AT LEAST ONE parent
// (half-siblings included); `start` itself is excluded, and a full sibling reached through two
// shared parents is collected once (the Set). A founder (no parents) has none — the empty
// adjacency entry yields an empty set, no first-run branch. [LAW:dataflow-not-control-flow]
function siblingsOf(
  childToParents: ReadonlyMap<string, string[]>,
  parentToChildren: ReadonlyMap<string, string[]>,
  start: string,
): string[] {
  const out = new Set<string>()
  for (const parent of childToParents.get(start) ?? []) {
    for (const child of parentToChildren.get(parent) ?? []) {
      if (child !== start) out.add(child)
    }
  }
  return [...out].sort()
}

// [LAW:dataflow-not-control-flow] One tree-builder for both directions — `adj` is the parents map
// for ancestry, the children map for offspring; the node shape and recursion are identical, only
// the data differs. A node's subtree is expanded once (the `expanded` set bounds work to O(nodes)
// on a diamond DAG); a re-encountered node renders as a leaf tile, so every relationship edge is
// shown without exponential blowup. The empty-kin case (founder up / leaf down) falls out of an
// empty adjacency entry — no first-run branch.
function buildTree(
  adj: ReadonlyMap<string, string[]>,
  root: string,
  phenotype: ReadonlyMap<string, Media>,
): GenealogyNode[] {
  const expanded = new Set<string>()
  const toNode = (id: string): GenealogyNode => {
    const first = !expanded.has(id)
    expanded.add(id)
    return {
      postId: PostId(id),
      // `?? null` is genuine optionality: a node absent from `phenotype` is a real generation
      // that has not rendered (pending/running/failed), so it has no phenotype. NOT a guard.
      thumbnail: phenotype.get(id) ?? null,
      kin: first ? (adj.get(id) ?? []).map(toNode) : [],
    }
  }
  return (adj.get(root) ?? []).map(toNode)
}

// [LAW:one-source-of-truth] The genealogy is a pure fold over (the lineage_edges DAG, each node's
// render). It reads the whole skinny edge table, builds the child→parent and parent→child
// adjacency (the same idiom genome-dag/feed apply), slices the subgraph reachable from `postId`,
// then reads ONLY that slice's phenotypes. A founder with no offspring yields two empty arrays.
export async function getGenealogy(env: Env, postId: PostId): Promise<Genealogy> {
  const database = db(env)
  const edgeRows = await database
    .select({ child: lineageEdges.childGenomeId, parent: lineageEdges.parentGenomeId })
    .from(lineageEdges)
    // [LAW:types-are-the-program] A bred node's [a, b] is a TUPLE, so parent order must be stable
    // across reads — order by parent id, matching the whole-DAG reader's ordering.
    .orderBy(asc(lineageEdges.parentGenomeId))

  const childToParents = new Map<string, string[]>()
  const parentToChildren = new Map<string, string[]>()
  for (const e of edgeRows) {
    const ps = childToParents.get(e.child)
    if (ps) ps.push(e.parent)
    else childToParents.set(e.child, [e.parent])
    const cs = parentToChildren.get(e.parent)
    if (cs) cs.push(e.child)
    else parentToChildren.set(e.parent, [e.child])
  }

  const ancestorIds = reachable(childToParents, postId)
  const offspringIds = reachable(parentToChildren, postId)
  // Siblings are peers, NOT reachable up or down, so their ids must join the phenotype slice
  // explicitly — otherwise a sibling tile would render blank for want of its thumbnail read.
  const siblingIds = siblingsOf(childToParents, parentToChildren, postId)
  const nodeIds = [...new Set([...ancestorIds, ...offspringIds, ...siblingIds])]
  if (nodeIds.length === 0) return { ancestors: [], offspring: [], siblings: [] }

  const phenotype = await readPhenotypes(database, nodeIds)

  return {
    ancestors: buildTree(childToParents, postId, phenotype),
    offspring: buildTree(parentToChildren, postId, phenotype),
    // Flat peers: each sibling is a leaf here (kin:[]) — its own ancestry/offspring belong to
    // ITS genealogy, not this post's. Thumbnail read from the same slice; null if unrendered.
    siblings: siblingIds.map((id) => ({ postId: PostId(id), thumbnail: phenotype.get(id) ?? null, kin: [] })),
  }
}

// [LAW:single-enforcer] The ONE phenotype-slice read for a genealogy/dynasty node set — chunked under
// D1's bind cap (never silently truncated), and a node id with no generations row is storage corruption
// (a lineage edge endpoint that is not a genome) so it fails loud rather than vanishing into a blank
// tile. [LAW:no-silent-fallbacks] Both the per-post tree and the dynasty fold read thumbnails this way.
async function readPhenotypes(
  database: ReturnType<typeof db>,
  nodeIds: readonly string[],
): Promise<Map<string, Media>> {
  const present = new Set<string>()
  const phenotype = new Map<string, Media>()
  for (let i = 0; i < nodeIds.length; i += PARAM_CAP) {
    const batch = nodeIds.slice(i, i + PARAM_CAP)
    const genRows = await database
      .select({ postId: generations.postId, status: generations.status, outputJson: generations.outputJson })
      .from(generations)
      .where(inArray(generations.postId, [...batch]))
    for (const r of genRows) {
      present.add(r.postId)
      if (r.status === 'succeeded') phenotype.set(r.postId, parsePhenotype(r.outputJson, r.postId))
    }
  }
  for (const id of nodeIds) {
    if (!present.has(id)) {
      throw new Error(`genealogy: lineage node ${id} has no generations row — a genome must be a generation`)
    }
  }
  return phenotype
}

// [LAW:one-source-of-truth] The whole-DYNASTY fold (slopspot-genome-p6z.2) — one level UP from the
// per-post slice: roots at the post's FOUNDER(S) and builds each founding line's WHOLE descendant tree.
// It reuses the SAME lineage_edges source + buildTree + phenotype read getGenealogy uses (the dynasty is
// a SLICE, lighter than getLineageDag's whole-generations load — the global forest p6z.2.1 is the
// getLineageDag consumer). A bred post descends from MULTIPLE founders (ancestralFounders is a SET — the
// honest DAG), so this returns the small FOREST of every founding line, never a false single root.
export async function getDynasty(env: Env, postId: PostId): Promise<Dynasty> {
  const database = db(env)
  const edgeRows = await database
    .select({ child: lineageEdges.childGenomeId, parent: lineageEdges.parentGenomeId })
    .from(lineageEdges)
    .orderBy(asc(lineageEdges.parentGenomeId))

  const childToParents = new Map<string, string[]>()
  const parentToChildren = new Map<string, string[]>()
  for (const e of edgeRows) {
    const ps = childToParents.get(e.child)
    if (ps) ps.push(e.parent)
    else childToParents.set(e.child, [e.parent])
    const cs = parentToChildren.get(e.parent)
    if (cs) cs.push(e.child)
    else parentToChildren.set(e.parent, [e.child])
  }

  // [LAW:dataflow-not-control-flow] The founders this post descends from: every 0-parent node among
  // its ancestors, plus the post itself if IT has no parent (a lone founder is its own dynasty). A
  // node is a founder when it has no entry in childToParents — a data fact, not a flag. Sorted for a
  // stable forest order.
  const isFounder = (id: string) => (childToParents.get(id) ?? []).length === 0
  const founderIds = [...new Set([postId, ...reachable(childToParents, postId)])].filter(isFounder).sort()

  // The dynasty's node set: every founder + every descendant of each, so the phenotype slice covers
  // the whole forest in one read. Deduped across founders that share descendants (a bred diamond).
  // [LAW:no-defensive-null-guards] No empty-guard: walking up a finite acyclic DAG always terminates
  // at a 0-parent node, so founderIds (which also includes postId itself when it has no parents) is
  // never empty — every post HAS a founder. nodeIds is therefore always ≥1; an unreachable guard would
  // be dead code masking that invariant.
  const nodeIds = [
    ...new Set(founderIds.flatMap((f) => [f, ...reachable(parentToChildren, f)])),
  ]

  const phenotype = await readPhenotypes(database, nodeIds)

  // Each founder is the ROOT of its line: its own tile + buildTree of its whole descendant subtree
  // (offspring-down). buildTree dedups a bred diamond (a node reached via two paths renders once, then
  // as a leaf), so the forest is bounded. [LAW:one-type-per-behavior] same GenealogyNode tree the
  // per-post offspring uses.
  const founders: GenealogyNode[] = founderIds.map((f) => ({
    postId: PostId(f),
    thumbnail: phenotype.get(f) ?? null,
    kin: buildTree(parentToChildren, f, phenotype),
  }))
  return { founders }
}
