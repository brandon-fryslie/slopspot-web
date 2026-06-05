// [LAW:single-enforcer] The derived genealogy read-models — founders, speciation, dynasties, and a
// bloodline's per-citizen fitness — all FOLDS over (the lineage DAG, votes), never stored flags. If
// two of these could disagree, the model is wrong: there is one source (the DAG + the votes) and
// each of these is a pure fold over it. [LAW:one-source-of-truth]
//
// [LAW:one-way-deps] Pure: over the DAG snapshot (genome-dag.ts) + a votes lookup the caller
// supplies. No env, no I/O, no clock. The render (the family-tree view) consumes these data shapes
// later; this layer never touches feed.ts / the card.

import { geneticDistance, type GeneticDistance } from '~/lib/genome-distance'
import type { GenomeId } from '~/lib/domain'
import type { LineageDag } from '~/db/genome-dag'

// [LAW:variability-at-edges] Speciation policy lives HERE, at this layer's edge — never inside the
// geneticDistance measurement (which stays a pure, threshold-free, non-commensurable pair). Two
// INDEPENDENT named thresholds, combined by OR: a bloodline that has swapped enough genes is a new
// species even with neutral traits (the doc's "a baroque cathedral sharing ONE gene with its
// founder" = three gene-swaps, no trait-drift required), and so is one whose traits wandered far
// enough even with its genes intact. AND would contradict the doc's own example; a combined scalar
// would assert the two axes trade off, which they do not.
export const GENE_SWAP_THRESHOLD = 3 // of 4 genes — "shares one gene with its founder"
export const TRAIT_DRIFT_THRESHOLD = 1.5 // L1 over the four [0,1] axes (max 4)

// [LAW:types-are-the-program] A founder's standing: how large a bloodline it rooted. "Founder" is
// not a flag — it is a node with no parents; its weight is its descendant-subtree size, derived.
export type FounderStat = { id: GenomeId; descendantCount: number }

// One ancestral founder's relationship to a genome: how far the genome has drifted from that root,
// and whether that exceeds the speciation policy. A bred genome has MANY of these (it descends from
// multiple founders) — modelling "the founder" as one node would be a false theorem in a DAG.
export type FounderDistance = { founder: GenomeId; distance: GeneticDistance; speciated: boolean }

// A genome's speciation read-model: its distance from EVERY founder it descends from, and the
// verdict. New species = drifted past the threshold from EVERY root it came from (if it is still
// close to any founder, it has not speciated from that line yet).
export type Speciation = { founders: readonly FounderDistance[]; isNewSpecies: boolean }

// A dynasty: a founder whose bloodline grew past the threshold — its own page's worth of lineage.
export type Dynasty = { founder: GenomeId; bloodline: readonly GenomeId[]; size: number }

// "Large bloodline" — a founder with at least this many descendants is a dynasty. A policy const at
// this edge, surfaced and tunable; not a magic number buried in a fold.
export const DYNASTY_THRESHOLD = 5

const speciatedFrom = (d: GeneticDistance): boolean =>
  d.geneMismatches >= GENE_SWAP_THRESHOLD || d.traitDrift >= TRAIT_DRIFT_THRESHOLD

// [LAW:types-are-the-program] The set of ancestral founders — every 0-parent node reachable by
// walking UP the parent edges. A bred node yields multiple; a founder yields itself. `seen` dedups
// the diamonds a breeding DAG creates (a node reached via two parent paths), so the walk terminates
// and never double-visits — necessary for correctness on a DAG, not a defensive guard.
export function ancestralFounders(dag: LineageDag, id: GenomeId): GenomeId[] {
  const founders = new Set<GenomeId>()
  const seen = new Set<GenomeId>()
  const stack: GenomeId[] = [id]
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    const ps = dag.parents.get(cur)
    if (ps === undefined || ps.length === 0) founders.add(cur)
    else for (const p of ps) stack.push(p)
  }
  return [...founders]
}

// Every genome reachable DOWN the child edges (excluding `id` itself). Deduped across diamonds, so a
// genome bred back into a line it already descends from is counted once.
export function descendants(dag: LineageDag, id: GenomeId): Set<GenomeId> {
  const out = new Set<GenomeId>()
  const stack: GenomeId[] = [...(dag.children.get(id) ?? [])]
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (out.has(cur)) continue
    out.add(cur)
    for (const c of dag.children.get(cur) ?? []) stack.push(c)
  }
  return out
}

// Every founder (0-parent node) + the size of the bloodline it rooted. Founder-ness is derived from
// the DAG, never an is_founder column.
export function founders(dag: LineageDag): FounderStat[] {
  const out: FounderStat[] = []
  for (const id of dag.nodes.keys()) {
    const ps = dag.parents.get(id)
    if (ps === undefined || ps.length === 0) out.push({ id, descendantCount: descendants(dag, id).size })
  }
  return out
}

// [LAW:one-source-of-truth] Speciation as a fold of geneticDistance over the genome's ancestral
// founders. New species = speciated from EVERY founder it descends from. A founder measured against
// itself is distance {0,0} → not speciated → not a new species, which falls out by construction.
export function speciation(dag: LineageDag, id: GenomeId): Speciation {
  const node = dag.nodes.get(id)
  if (node === undefined) throw new Error(`genealogy: unknown genome ${id}`)
  const founderDistances = ancestralFounders(dag, id).map((founderId): FounderDistance => {
    const founder = dag.nodes.get(founderId)
    if (founder === undefined) throw new Error(`genealogy: ancestral founder ${founderId} missing from DAG`)
    const distance = geneticDistance(node, founder)
    return { founder: founderId, distance, speciated: speciatedFrom(distance) }
  })
  return {
    founders: founderDistances,
    isNewSpecies: founderDistances.length > 0 && founderDistances.every((f) => f.speciated),
  }
}

// The dynasties: founders whose bloodline crossed DYNASTY_THRESHOLD, with the full bloodline (the
// founder + its descendants). The deferred family-tree view renders one of these as "its own page."
export function dynasties(dag: LineageDag): Dynasty[] {
  return founders(dag)
    .filter((f) => f.descendantCount >= DYNASTY_THRESHOLD)
    .map((f) => {
      const line = descendants(dag, f.id)
      return { founder: f.id, bloodline: [f.id, ...line], size: line.size + 1 }
    })
}

// [LAW:one-source-of-truth] A bloodline's fitness IN ONE NICHE — the intra-niche GRADIENT L3's
// uniform ±1 lacks: a citizen's votes summed across a genome AND its whole descendant line. The
// votes are supplied per-citizen (the caller filters), so this stays a pure fold. genome-9zt.7
// wires it into genepool's {ref, fitness} seam (a deliberate, separately-gated behavioral change);
// here it is computed and proven as a read-model only — no live-selection change rides in.
export function bloodlineFitness(
  dag: LineageDag,
  votesByGenome: ReadonlyMap<GenomeId, number>,
  id: GenomeId,
): number {
  let sum = votesByGenome.get(id) ?? 0
  for (const d of descendants(dag, id)) sum += votesByGenome.get(d) ?? 0
  return sum
}
