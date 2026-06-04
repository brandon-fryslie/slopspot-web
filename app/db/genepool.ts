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
// [LAW:dataflow-not-control-flow] Always the same query shape; the niche VALUE picks the
// voter-set predicate (one citizen's id, or every voter NOT a citizen). An empty result is
// data (the niche has selected nothing breedable yet) and the fold degrades to founder with
// no "first run" branch.

import { and, desc, eq, notInArray, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { generations, posts, votes } from '~/db/schema'
import { PostId } from '~/lib/domain'

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

// The fittest `n` rendered genomes WITHIN this niche — succeeded generations the niche has voted
// on, ordered by the niche's net vote. Only a SUCCEEDED generation is breedable (a pending/failed
// genome has genes but no phenotype that could have received selection; only generations carry a
// genome). Bounding to top `n` keeps the cron read cheap; id is the deterministic tie-breaker so
// the snapshot is a function of DB state alone.
export async function getNicheGenePool(env: Env, niche: Niche, n: number): Promise<FitnessCandidate[]> {
  const fitness = sql<number>`sum(${votes.value})`
  const rows = await db(env)
    .select({ postId: posts.id, fitness })
    .from(posts)
    .innerJoin(generations, eq(generations.postId, posts.id))
    .innerJoin(votes, eq(votes.postId, posts.id))
    .where(and(eq(posts.contentKind, 'generation'), eq(generations.status, 'succeeded'), voterPredicate(niche)))
    .groupBy(posts.id)
    .orderBy(desc(fitness), desc(posts.id))
    .limit(n)

  return rows.map((row) => ({ ref: PostId(row.postId), fitness: Number(row.fitness) }))
}
