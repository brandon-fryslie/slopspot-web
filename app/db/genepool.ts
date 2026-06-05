// [LAW:single-enforcer] The selection fold's read-side dependency on storage, exactly
// once — a snapshot of one NICHE's breedable gene pool. Same trust-boundary pattern as
// recent.ts (a narrow projection mirroring feed.ts's storage→domain boundary), NOT feed.ts
// itself: selection needs only {ref, fitness}, never the full genome. The two chosen parents
// load their full genomes via getPostById downstream — this read decides eligibility + weight.
//
// [LAW:one-source-of-truth] Fitness is PER-NICHE, never the global posts.score. Each cast
// voter-citizen is a niche (one consistent taste); humans collectively are ONE niche (the
// popular line), never folded into the cast aggregate — folding them would recreate the
// consensus-monoculture the radiation exists to prevent (genome epic decision (A), CD-ruled).
// A line buried in niche X (fitness ≤ 0 there) dies in X but may be blessed in niche Y; death
// is niche-LOCAL and emerges from non-selection, never a global predicate.
//
// [LAW:one-source-of-truth] Fitness is the BLOODLINE AGGREGATE (genome-9zt.7): the niche's votes
// summed across a candidate's WHOLE DESCENDANT LINE (bloodlineFitness over the lineage DAG), not
// the one-off vote on that single post. This is the intra-niche GRADIENT L3 lacked — a founder
// whose line a niche has consistently blessed outweighs a single upvote, so fitter LINES reproduce
// more. RAW (no dampening): intra-niche amplification IS the niche's radiation; city-variety is
// protected STRUCTURALLY (FOUNDER_RATE novelty injection + the untouched cross-niche populist-mean
// guard), never by patching the fitness value. selectionWeight is the one edge where a soul-ruled
// dampener could drop in [LAW:variability-at-edges].
//
// [LAW:dataflow-not-control-flow] The niche VALUE picks the voter-set predicate; an unengaged line
// (zero bloodline votes) contributes no candidate row, the same shape the old direct-vote join
// encoded. An empty pool degrades to founder with no "first run" branch.

import { eq, inArray, notInArray, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { generations, votes } from '~/db/schema'
import { GenomeId, PostId } from '~/lib/domain'
import { getLineageDag } from '~/db/genome-dag'
import { bloodlineFitness } from '~/lib/genealogy'
import { recencyWeight } from '~/lib/recency'

// [LAW:variability-at-edges] The recency half-life — the genepool's rate for the city's ONE decay
// function (recency.ts). A vote halves in selection weight every 30 days, so a niche's CURRENT
// taste outweighs a line's historical accumulation: an incumbent dynasty's reign decays to an
// EARNED peer as the niche's blessings shift, rather than the past permanently out-voting the
// present (genome-9zt.7, CD-ruled recency-to-parity). The sim proved the MECHANISM (decay restores
// bounded contestability while preserving convergence); this rate is the felt taste-shift timescale,
// a tunable named const here at the edge, not buried in a fold. genome .3 sets its own rate.
const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000

// [LAW:types-are-the-program] A breedable candidate: a reference to a rendered genome and its
// fitness as a selection WEIGHT — the net vote this niche cast on it. The full genome is loaded
// lazily for the winners; a candidate the niche never selected simply does not appear (no row),
// so unselected genomes carry no weight without a guard.
export type FitnessCandidate = {
  ref: PostId
  fitness: number
}

// [LAW:types-are-the-program] A niche IS its selection set, and the discriminator is which set:
// a `citizen` niche sums exactly one cast voter's votes (a single consistent taste); the
// `populist` niche sums every voter that is NOT a cast citizen (the human popular line). The
// union makes "humans folded into a citizen's niche" unrepresentable — they are their own niche
// by construction, never an addend to the cast.
export type Niche =
  | { kind: 'citizen'; voterId: string }
  | { kind: 'populist'; citizenVoterIds: readonly string[] }

// [LAW:dataflow-not-control-flow] The niche value selects the voter-set predicate; everything
// else is one fixed query. `populist` with no known citizens excludes nothing (every voter is
// human), expressed as an absent predicate rather than a `NOT IN ()` footgun — and() drops the
// undefined. A citizen niche pins a single voterId, whose SUM is that one cast member's vote.
function voterPredicate(niche: Niche) {
  return niche.kind === 'citizen'
    ? eq(votes.voterId, niche.voterId)
    : niche.citizenVoterIds.length > 0
      ? notInArray(votes.voterId, [...niche.citizenVoterIds])
      : undefined
}

// [LAW:variability-at-edges] The bloodline-sum → selection-weight transform, isolated as the ONE
// edge where a CD soul-ruling could drop a dampener (e.g. sign-preserving sqrt/log) before the .7
// deploy — WITHOUT touching the {ref, fitness} seam, select.ts, or the candidate set. RAW today:
// the honest "votes summed across the line." A dampener, if ruled in, must preserve sign so a
// buried line (negative) stays buried; RAW is sign-preserving by being the identity.
const selectionWeight = (bloodlineSum: number): number => bloodlineSum

// The niche's RECENCY-WEIGHTED net vote on each genome it has touched, keyed by genome id. Each
// individual vote is decayed by its age (nowMs − createdAt) through the city's one decay function,
// then summed — so a fresh blessing counts in full while an ancient one fades. The bloodline fold
// (genealogy.ts) is UNCHANGED: it still sums a weight-per-genome map over each candidate's line; the
// recency lives entirely HERE, in how the weights are built. A populist niche with no known citizens
// counts every voter (the `1=1` no-op filter).
async function nicheVotesByGenome(env: Env, niche: Niche, nowMs: number): Promise<Map<GenomeId, number>> {
  const pred = voterPredicate(niche)
  const rows = await db(env)
    .select({ postId: votes.postId, value: votes.value, createdAt: votes.createdAt })
    .from(votes)
    .where(pred ?? sql`1=1`)

  const out = new Map<GenomeId, number>()
  for (const row of rows) {
    const id = GenomeId(row.postId)
    const weight = row.value * recencyWeight(nowMs - row.createdAt.getTime(), RECENCY_HALF_LIFE_MS)
    out.set(id, (out.get(id) ?? 0) + weight)
  }
  return out
}

// Every breedable genome's id — a SUCCEEDED generation (only a rendered phenotype can have received
// selection; only a generation carries a genome). The candidate set; bloodline fitness weights them.
async function succeededGenomeIds(env: Env): Promise<PostId[]> {
  const rows = await db(env)
    .select({ postId: generations.postId })
    .from(generations)
    .where(eq(generations.status, 'succeeded'))
  return rows.map((row) => PostId(row.postId))
}

// The fittest `n` rendered genomes WITHIN this niche, weighted by RECENCY-DECAYED BLOODLINE fitness
// — the niche's recently-weighted votes summed across each candidate's whole descendant line
// (genome-9zt.7's intra-niche gradient, with living-relevance decay). A genome whose line the niche
// never touched contributes no row, the same shape the old direct-vote join encoded; select.ts
// filters the remaining negatives. `nowMs` is the decay reference (the fire's scheduled time).
// Bounding to top `n` keeps the cron read manageable; id is the deterministic tie-breaker. The
// whole-DAG fold + per-vote decay is a cron-path cost (off a5w's hot-read budget), a flagged future
// materialization candidate.
export async function getNicheGenePool(
  env: Env,
  niche: Niche,
  n: number,
  nowMs: number,
): Promise<FitnessCandidate[]> {
  const [dag, nicheVotes, succeeded] = await Promise.all([
    getLineageDag(env),
    nicheVotesByGenome(env, niche, nowMs),
    succeededGenomeIds(env),
  ])

  const candidates: FitnessCandidate[] = []
  for (const ref of succeeded) {
    const raw = bloodlineFitness(dag, nicheVotes, GenomeId(ref))
    if (raw === 0) continue
    candidates.push({ ref, fitness: selectionWeight(raw) })
  }
  candidates.sort((a, b) => b.fitness - a.fitness || (a.ref < b.ref ? 1 : a.ref > b.ref ? -1 : 0))
  return candidates.slice(0, n)
}

// [LAW:single-enforcer] The niche-pick's read-side dependency: how many votes each cast citizen
// has cast — its SELECTION ACTIVITY, the weight by which an active critic exerts more pressure on
// which niche breeds. Only citizen voterIds are counted; human activity never enters niche-pick
// (the populist's pick weight is derived from citizen activity in firehose/niche.ts, so crowd
// VOLUME cannot dominate the cross-niche pick — the monoculture guard, by construction).
//
// [LAW:dataflow-not-control-flow] An empty citizen set has no counts to read; returning the empty
// Map is the query's identity (inArray of nothing is nothing), not a skipped operation. A citizen
// with zero votes is absent from the result — the caller reads a missing entry as zero activity.
export async function getCitizenVoteCounts(
  env: Env,
  voterIds: readonly string[],
): Promise<Map<string, number>> {
  if (voterIds.length === 0) return new Map()
  const rows = await db(env)
    .select({ voterId: votes.voterId, count: sql<number>`count(*)` })
    .from(votes)
    .where(inArray(votes.voterId, [...voterIds]))
    .groupBy(votes.voterId)
  return new Map(rows.map((row) => [row.voterId, Number(row.count)]))
}
