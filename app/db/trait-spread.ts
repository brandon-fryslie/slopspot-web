// [LAW:single-enforcer] The breadth measurement's read-side dependency on storage lives here exactly
// once. Same storage→domain trust-boundary shape as feed.ts / recent.ts, narrower still: the breadth
// question needs only the heritable trait vector and the materialized score, nothing else.
//
// [LAW:no-silent-failure] This DIRECT read is the ticket's PROOF surface (slopspot-genome-1l7). The
// [metric]→VictoriaMetrics puller does NOT exist yet (efficiency-a5w.7), so the emit in
// app/agents/traitSpread.ts may reach Workers Logs but no dashboard — a metric is not evidence until
// something collects it. The spread is therefore PROVEN by reading D1 here and computing it directly
// (app/lib/trait-spread), never by trusting a possibly-uncollected emit.

import { eq } from 'drizzle-orm'
import { db } from '~/db/client'
import { generations, posts } from '~/db/schema'
import { traitVectorSchema } from '~/lib/traits'
import type { ScoredTraits } from '~/lib/trait-spread'

// [LAW:dataflow-not-control-flow] One query, every time; the result length is data (an empty DB
// yields [], which buildSpreadReport reduces to a zero-spread report — no "first run" branch).
//
// [LAW:one-source-of-truth] score is posts.score — the 0028 MATERIALIZED SUM(votes.value) the feed
// already ranks by. It is READ here, never re-derived as a second SUM(votes) (the forbidden second
// source that would silently diverge from what the feed shows).
//
// Restricted to SUCCEEDED generations: the breadth question is about what landed on the FEED. A
// failed/pending attempt carries a trait vector but never becomes a visible, votable post, so it is
// not part of the generated-vs-surviving ecology (and its score-0 would falsely pad the low end).
export async function readScoredGenerationTraits(env: Env): Promise<ScoredTraits[]> {
  const rows = await db(env)
    .select({
      traitsJson: generations.traitsJson,
      score: posts.score,
      postId: generations.postId,
    })
    .from(generations)
    .innerJoin(posts, eq(posts.id, generations.postId))
    .where(eq(generations.status, 'succeeded'))

  // [LAW:types-are-the-program] Re-validate traits_json at the D1 boundary: storage can hold a value
  // raw SQL wrote that the domain forbids (an extra key, an out-of-range axis). A malformed vector
  // fails loud here, localized to the offending post, never laundered into the spread arithmetic.
  return rows.map((row) => ({
    traits: traitVectorSchema.parse(JSON.parse(row.traitsJson)),
    score: row.score,
  }))
}
