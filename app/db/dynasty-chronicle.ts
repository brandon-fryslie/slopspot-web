// [LAW:single-enforcer] The annotated-bloodline read-model for the dynasty page — the SURFACE of the
// genealogy folds (founders, speciation drift, inbreeding) for ONE post's bloodline. Distinct from
// getDynasty (genealogy-view.ts), which is the thumbnail FOREST: this is the genome-material annotation
// (genes/traits → distance), a different behavior over the same lineage source, so a different read.
// [LAW:one-type-per-behavior] the thumbnail tree and the annotated chronicle are two read-models, joined
// at the view by post id — never one type carrying both the Media tree and the genetic verdicts.
//
// [LAW:one-source-of-truth] Founder / drift / inbreeding are FOLDS over (the lineage DAG + genome distance),
// never stored statuses. This loads the whole DAG (a page read, not the hot feed — the access pattern the
// epic blessed for single-post/dynasty PAGES) and folds it; nothing here is persisted.
// [LAW:effects-at-boundaries] the only I/O is the DAG read + the Gremlin persona read; the verdicts are pure.

import { gte } from 'drizzle-orm'
import { getLineageDag } from '~/db/genome-dag'
import { db } from '~/db/client'
import { votes } from '~/db/schema'
import { STANDING_WINDOW_MS, priorSum, recentSum } from '~/db/standing'
import {
  ancestralFounders,
  bloodlineFitness,
  descendants,
  founders as allFounders,
  generationDepth,
  inbreedingOf,
  speciation,
  type Inbreeding,
  type Speciation,
} from '~/lib/genealogy'
import { gremlinInbreedingRemark } from '~/lib/inbreeding-voice'
import { getPersona } from '~/agents/persona'
import { GenomeId, PostId } from '~/lib/domain'
import { standingOf, type Standing } from '~/lib/standing'
import { withheld, type Utterance, type VoicedPersonaRef } from '~/lib/voice'
import type { GeneticDistance } from '~/lib/genome-distance'

// The city's skeptic — the designated noticer of inbreeding (the-cast.md). The persona ROW (its traits +
// character bible) is the source of truth for who the Gremlin is; this is only its stable lookup key, the
// same way rite.ts keys the presiding citizens by handle.
const GREMLIN = 'agent:skeptic'

// A founder of this bloodline, honored by the size of the line it rooted — a Relic candidate (the Wednesday
// rite resurrects old roots; the Calendar of Saints venerates the crowned Relics). `standing` is the
// bloodline's reception ARC (genome-p6z.7): the SAME ascendant/steady/fading the roll call gives a citizen,
// read over this founder's whole line instead of over one citizen's deeds — net votes the line drew in the
// recent window against the prior. [LAW:one-type-per-behavior] one arc, two subjects (citizen, bloodline).
export type FounderHonor = { postId: PostId; descendantCount: number; standing: Standing }

// One generation's drift: its depth from the founder(s) and the speciation verdict — the distance it has
// wandered from every root it descends from. Ordered founder→leaf, this is the drift you can scroll.
export type DriftEntry = { postId: PostId; depth: number; speciation: Speciation }

// A bred node whose two parents fell within the inbreeding epsilon — flagged, with the closeness that
// earned the flag and the Gremlin's spoken verdict on it.
export type InbredEntry = { postId: PostId; distance: GeneticDistance; remark: Utterance }

// [LAW:types-are-the-program] The whole annotated chronicle for a post's bloodline. Three empty arrays is a
// post with no resolvable bloodline (degenerate) — the renderer shows nothing by data, no flag.
export type DynastyChronicle = {
  founders: readonly FounderHonor[]
  drift: readonly DriftEntry[]
  inbred: readonly InbredEntry[]
}

// The Gremlin's VoicedPersonaRef, or null when the persona row is absent (a misconfiguration the page must
// not 500 on). Base traits, not accreted: the page renders the inbreeding aside from its deterministic floor,
// which reads neither traits nor prompt — they are carried only to satisfy the verdict speaker's type.
async function loadGremlin(env: Env): Promise<VoicedPersonaRef | null> {
  const persona = await getPersona(env, GREMLIN)
  return persona === null
    ? null
    : {
        handle: persona.agentId,
        displayName: persona.displayName,
        traits: persona.traits,
        personaPrompt: persona.personaPrompt,
      }
}

// [LAW:effects-at-boundaries] The bloodline's reception, gathered at the storage boundary into the two
// adjacent windows standingOf compares — net votes RECEIVED per genome (a slop's reception is the votes
// its post drew, the same maker currency standing.ts sums), split recent-vs-prior by when each was cast.
// Grouped by post_id because a genome IS its post, so NO attribution predicate is needed — the genome key
// is the join, sidestepping the json_extract/index discipline citizen standing requires. Windowed to the
// two-window span (a page read, not the hot feed); a genome with no votes in the span is the honest absent
// key, which bloodlineFitness reads as zero — the same way getStandings treats an unvoted citizen.
// [LAW:one-source-of-truth] window width + the window-split SQL come from db/standing.ts; this is the
// citizen read's genome-grouped sibling, not a second windowing policy.
async function votesByGenomeWindowed(
  env: Env,
  nowMs: number,
): Promise<{ recent: ReadonlyMap<GenomeId, number>; prior: ReadonlyMap<GenomeId, number> }> {
  const recentStartMs = nowMs - STANDING_WINDOW_MS
  const priorStartMs = nowMs - 2 * STANDING_WINDOW_MS
  const rows = await db(env)
    .select({
      genome: votes.postId,
      recent: recentSum(recentStartMs),
      prior: priorSum(recentStartMs, priorStartMs),
    })
    .from(votes)
    .where(gte(votes.createdAt, new Date(priorStartMs)))
    .groupBy(votes.postId)
  const recent = new Map<GenomeId, number>()
  const prior = new Map<GenomeId, number>()
  for (const r of rows) {
    recent.set(GenomeId(r.genome), r.recent)
    prior.set(GenomeId(r.genome), r.prior)
  }
  return { recent, prior }
}

// `nowMs` is the request boundary's clock (the loader's Date.now()), passed in so the window edge is an
// argument the reader is given, never a clock the fold reaches for. [LAW:no-ambient-temporal-coupling] —
// the same discipline getStandings uses, and it keeps the two-window split deterministic under test.
export async function getDynastyChronicle(env: Env, postId: PostId, nowMs: number): Promise<DynastyChronicle> {
  const dag = await getLineageDag(env)
  const root = GenomeId(postId)
  // A non-generation or unknown id has no genome in the DAG and thus no bloodline to chronicle.
  if (!dag.nodes.has(root)) return { founders: [], drift: [], inbred: [] }

  // The founders THIS post descends from (its bloodline's roots) — scoped to the bloodline, never the whole
  // DAG's founders. Their whole descendant lines are the bloodline node set.
  const founderIds = ancestralFounders(dag, root)
  const founderSet = new Set(founderIds)
  const bloodline = new Set<GenomeId>()
  for (const f of founderIds) {
    bloodline.add(f)
    for (const d of descendants(dag, f)) bloodline.add(d)
  }

  // [LAW:no-silent-failure][LAW:types-are-the-program] Founder honor — derived DIRECTLY from the founder
  // stats, never a Map-then-rejoin with a `?? 0` fallback that would hide a missing founder behind a
  // plausible zero. allFounders already pairs each 0-parent node with its descendant count; this bloodline's
  // founders are exactly those in the ancestral set, so a filter (not a lookup that can miss) yields the
  // honor list. Each founder's STANDING is its line's reception arc: bloodlineFitness sums the votes the
  // founder + its whole descendant subtree drew in each window (the SAME scope descendantCount measures),
  // and standingOf reads the arc — a genome with no votes folds to zero by the absent-key, no branch.
  // Most-founding first.
  const { recent: recentVotes, prior: priorVotes } = await votesByGenomeWindowed(env, nowMs)
  const founders: FounderHonor[] = allFounders(dag)
    .filter((f) => founderSet.has(f.id))
    .map((f) => ({
      postId: PostId(f.id),
      descendantCount: f.descendantCount,
      standing: standingOf({
        recent: bloodlineFitness(dag, recentVotes, f.id),
        prior: bloodlineFitness(dag, priorVotes, f.id),
      }),
    }))
    .sort((a, b) => b.descendantCount - a.descendantCount || a.postId.localeCompare(b.postId))

  // Drift — every bloodline node's speciation verdict, ordered founder→leaf (depth, then id for stability).
  const drift: DriftEntry[] = [...bloodline]
    .map((id) => ({ postId: PostId(id), depth: generationDepth(dag, id), speciation: speciation(dag, id) }))
    .sort((a, b) => a.depth - b.depth || a.postId.localeCompare(b.postId))

  // Inbreeding — the bred nodes whose two parents fell within epsilon. The detection is a pure filter over
  // the bloodline; the Gremlin then notices each (one verdict utterance per flagged node).
  const gremlin = await loadGremlin(env)
  const detections = [...bloodline]
    .map((id) => ({ id, ib: inbreedingOf(dag, id) }))
    .filter((x): x is { id: GenomeId; ib: Inbreeding } => x.ib !== null && x.ib.inbred)
    .sort((a, b) => a.id.localeCompare(b.id))
  const inbred: InbredEntry[] = await Promise.all(
    detections.map(async ({ id, ib }): Promise<InbredEntry> => {
      // [LAW:no-silent-failure] A bloodline member with no node is storage corruption — throw a descriptive
      // error, the same pattern genealogy.ts uses for every dag.nodes.get(), never an `!` that launders the
      // invariant violation into a bare TypeError.
      const node = dag.nodes.get(id)
      if (node === undefined) {
        throw new Error(`dynasty-chronicle: inbred bloodline member ${id} missing from the DAG`)
      }
      const utterance =
        gremlin === null
          ? // The Gremlin's row is absent — the flag stands (the cross IS inbred), but no machine could
            // voice it. An honest 'unavailable', never a fabricated line. [LAW:no-silent-failure]
            withheld('unavailable')
          : await gremlinInbreedingRemark(gremlin, { postId: PostId(id), prompt: node.utterance }, ib.distance)
      return { postId: PostId(id), distance: ib.distance, remark: utterance }
    }),
  )

  return { founders, drift, inbred }
}
