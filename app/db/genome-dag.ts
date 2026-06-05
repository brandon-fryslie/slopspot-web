// [LAW:single-enforcer] The read of the WHOLE lineage DAG + every genome's genetic material, in one
// place — the derived genealogy read-models (genome-9zt.4) fold over THIS snapshot, never over a
// per-page slice. Same narrow-read pattern the chooser's recent.ts established (its own trust-
// boundary parse, NOT feed.ts): feed.ts reconstructs a genome inline+unexported for the per-row
// render; this reconstructs the full pool + its edges for whole-DAG folds. No feed.ts surface is
// touched.
//
// [LAW:one-way-deps] A db-layer read. The pure derivations (genealogy.ts) fold its output with no
// I/O. A node IS a genome (a lineage node is literally a genome read back), so nodes carry full
// Genome values — lineage reconstructed from the edge count, the same fold feed.ts applies per row.

import { asc } from 'drizzle-orm'
import { db } from '~/db/client'
import { generations, lineageEdges } from '~/db/schema'
import { GenomeId, ProviderId, type Genome, type Lineage } from '~/lib/domain'
import { aspectRatioSchema, recipeSubjectSchema, styleFamilySchema } from '~/lib/variety'
import { traitVectorSchema } from '~/lib/traits'

// [LAW:types-are-the-program] The DAG as three aligned views of one truth: every genome by id, and
// the child→parent / parent→child adjacency. A founder is a node with no parents; a leaf has no
// children. Diamonds (a bred node reached via two paths) are expected, so traversals dedup by id.
export type LineageDag = {
  nodes: ReadonlyMap<GenomeId, Genome>
  parents: ReadonlyMap<GenomeId, readonly GenomeId[]>
  children: ReadonlyMap<GenomeId, readonly GenomeId[]>
}

// [LAW:single-enforcer] The lineage read-model by edge COUNT — the same closed-union fold feed.ts
// applies per row, here over the whole DAG. A node IS a genome, so it carries its lineage; the
// genealogy folds use the adjacency maps, but a complete Genome is the honest node value.
function toLineage(parents: readonly GenomeId[], id: string): Lineage {
  switch (parents.length) {
    case 0:
      return { kind: 'founder' }
    case 1:
      return { kind: 'single', parent: parents[0]! }
    case 2:
      return { kind: 'bred', parents: [parents[0]!, parents[1]!] }
    default:
      throw new Error(`genome-dag: ${id} has ${parents.length} parent edges (expected 0, 1, or 2)`)
  }
}

function parseSlots(raw: string, id: string): Record<string, string> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (err) {
    throw new Error(`genome-dag: malformed slots_json for ${id}`, { cause: err })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`genome-dag: slots_json must be an object for ${id}`)
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== 'string') throw new Error(`genome-dag: non-string slot value for ${id} (slot=${k})`)
    out[k] = v
  }
  return out
}

function parseTraits(raw: string, id: string) {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (err) {
    throw new Error(`genome-dag: malformed traits_json for ${id}`, { cause: err })
  }
  return traitVectorSchema.parse(value)
}

// [LAW:dataflow-not-control-flow] One pair of queries every call; the maps' contents are data. An
// empty DB yields empty maps and every fold degrades to "no founders / zero descendants" with no
// first-run branch. Edges ordered by parent id so a bred node's [a, b] tuple is stable across reads.
export async function getLineageDag(env: Env): Promise<LineageDag> {
  const database = db(env)
  const [genRows, edgeRows] = await Promise.all([
    database
      .select({
        postId: generations.postId,
        styleFamily: generations.styleFamily,
        subjectTemplate: generations.subjectTemplate,
        slotsJson: generations.slotsJson,
        aspectRatio: generations.aspectRatio,
        providerId: generations.providerId,
        utterance: generations.utterance,
        traitsJson: generations.traitsJson,
      })
      .from(generations),
    database
      .select({ child: lineageEdges.childGenomeId, parent: lineageEdges.parentGenomeId })
      .from(lineageEdges)
      .orderBy(asc(lineageEdges.parentGenomeId)),
  ])

  const parents = new Map<GenomeId, GenomeId[]>()
  const children = new Map<GenomeId, GenomeId[]>()
  for (const e of edgeRows) {
    const child = GenomeId(e.child)
    const parent = GenomeId(e.parent)
    const p = parents.get(child)
    if (p) p.push(parent)
    else parents.set(child, [parent])
    const c = children.get(parent)
    if (c) c.push(child)
    else children.set(parent, [child])
  }

  const nodes = new Map<GenomeId, Genome>()
  for (const r of genRows) {
    const id = GenomeId(r.postId)
    nodes.set(id, {
      id,
      genes: {
        species: styleFamilySchema.parse(r.styleFamily),
        form: recipeSubjectSchema.parse({
          subjectTemplate: r.subjectTemplate,
          slots: parseSlots(r.slotsJson, r.postId),
        }),
        frame: aspectRatioSchema.parse(r.aspectRatio),
        medium: ProviderId(r.providerId),
      },
      utterance: r.utterance,
      traits: parseTraits(r.traitsJson, r.postId),
      lineage: toLineage(parents.get(id) ?? [], r.postId),
    })
  }

  return { nodes, parents, children }
}
