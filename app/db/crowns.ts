// [LAW:single-enforcer] The one module that reads and writes the crowns table.
// Three responsibilities, one home: persist a crowning (recordCrowning), read the
// vote extremes the rite weighs (gatherCandidates), and derive each visible post's
// eternal mark for the feed (crowningsForPosts). The election logic itself is pure
// and lives in app/lib/rite.ts; this module is its I/O boundary.
//
// [LAW:one-source-of-truth] The mark is never stored. crowningsForPosts derives it
// from the lens via markFor at read time — the same shape score=SUM(votes) takes in
// feed.ts. No is_crowned flag, no mark column.
//
// [LAW:one-way-deps] crowns.ts → db/client, db/schema, lib/rite (election vocab +
// mark), lib/voice (the Utterance it persists), lib/domain. The decree Utterance
// flows ONLY through the write path here; the read path surfaces just the mark, so
// the domain stays voice-free.

import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { crowns, generations, personas, posts, votes } from '~/db/schema'
import type { AgentId, Crowning, PostId } from '~/lib/domain'
import { markFor, riteLensSchema, type RiteCandidate, type RiteLens } from '~/lib/rite'
import type { Utterance } from '~/lib/voice'

// What recordCrowning persists: the crowned post, the liturgical day, the lens, the
// citizen who presided (recorded as fact, not re-derived), and the Proprietor's
// decree (a whole Utterance — spoke or a meant silence — kept forever).
export type CrowningRecord = {
  postId: PostId
  riteDay: string
  lens: RiteLens
  presiding: AgentId
  decree: Utterance
}

// [LAW:types-are-the-program] recordCrowning has two real outcomes: the crown was
// recorded, or the day was already crowned. The UNIQUE(rite_day) index makes "one
// ceremony per day" unrepresentable in storage, so a 3am cron re-fire returns
// `already_crowned_today` rather than double-crowning — idempotent by construction.
export type RecordCrowningResult =
  | { recorded: true; id: string }
  | { recorded: false; reason: 'already_crowned_today' }

// [LAW:single-enforcer] The one writer of a crown row. [LAW:types-are-the-program]
// The UNIQUE(rite_day) index IS the one-ceremony-per-day invariant; onConflictDoNothing
// makes a concurrent or retried re-fire converge on it without throwing, and RETURNING
// discriminates the outcome at the single statement — a returned row means THIS call
// recorded the crown, an empty result means the day was already crowned. No
// check-then-insert TOCTOU. The decree is serialized whole; a withheld decree (a
// Confession's held silence) persists as faithfully as a spoken one.
export async function recordCrowning(
  env: Env,
  input: CrowningRecord,
): Promise<RecordCrowningResult> {
  const database = db(env)
  const id = `crown:${crypto.randomUUID()}`
  const inserted = await database
    .insert(crowns)
    .values({
      id,
      postId: input.postId,
      riteDay: input.riteDay,
      lens: input.lens,
      presiding: input.presiding,
      decreeJson: JSON.stringify(input.decree),
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: crowns.riteDay })
    .returning({ id: crowns.id })
  if (inserted.length === 0) {
    return { recorded: false, reason: 'already_crowned_today' }
  }
  return { recorded: true, id: inserted[0].id }
}

// [LAW:dataflow-not-control-flow] The rite reads the votes that ALREADY exist — no
// new mechanic. One row per succeeded generation the city has judged (INNER JOIN
// votes): its net score and its blessing/burial counts, the extremes elect() reads.
// A post with no votes is not a candidate (the city said nothing about it); a
// candidate that clears no pole's bar simply yields the Unmoved Day downstream.
// [LAW:one-source-of-truth] The placard (a piece's display name) is NOT gathered here
// — it is derived in exactly one place (the feed reader's toContent, with its
// non-empty fallback). The orchestrator re-reads the WINNER through that canonical
// path, so a legacy blank title can never reach a decree.
export async function gatherCandidates(env: Env): Promise<RiteCandidate[]> {
  const database = db(env)
  const rows = await database
    .select({
      postId: generations.postId,
      score: sql<number>`sum(${votes.value})`,
      blessings: sql<number>`sum(case when ${votes.value} = 1 then 1 else 0 end)`,
      burials: sql<number>`sum(case when ${votes.value} = -1 then 1 else 0 end)`,
    })
    .from(generations)
    .innerJoin(posts, eq(posts.id, generations.postId))
    .innerJoin(votes, eq(votes.postId, generations.postId))
    .where(eq(generations.status, 'succeeded'))
    .groupBy(generations.postId)
  return rows.map((r) => ({
    postId: r.postId as PostId,
    score: r.score,
    blessings: r.blessings,
    burials: r.burials,
  }))
}

// [LAW:single-enforcer] One place derives the eternal mark for a set of visible
// posts — the read mirror of recordCrowning. Mirrors feed.ts's fetchVerdicts: a
// single bounded batch query keyed on the visible post ids, run after the feed CTE.
// A post may carry more than one crown across its life (rare); the row_number rank
// surfaces its LATEST (rite_day desc, then created_at desc) as the visible mark —
// every crown stays recorded, one shows.
//
// [LAW:one-source-of-truth] presiding resolves the recorded agentId into its public
// CitizenRef via the personas table (LEFT JOIN — a retired/absent persona falls back
// to its agentId as the label, the documented persona-less fallback). The lens is
// re-validated at this storage boundary (riteLensSchema) the way feed.ts re-parses
// styleFamily; the mark is markFor(lens), never read from a column.
export async function crowningsForPosts(
  database: ReturnType<typeof db>,
  postIds: readonly string[],
): Promise<Map<string, Crowning>> {
  if (postIds.length === 0) return new Map()

  const ranked = database
    .select({
      postId: crowns.postId,
      lens: crowns.lens,
      riteDay: crowns.riteDay,
      presiding: crowns.presiding,
      handle: personas.handle,
      displayName: personas.displayName,
      rank: sql<number>`row_number() over (
        partition by ${crowns.postId}
        order by ${crowns.riteDay} desc, ${crowns.createdAt} desc
      )`.as('crown_rank'),
    })
    .from(crowns)
    .leftJoin(personas, eq(personas.agentId, crowns.presiding))
    .where(inArray(crowns.postId, postIds))
    .as('ranked_crowns')

  const rows = await database
    .select({
      postId: ranked.postId,
      lens: ranked.lens,
      riteDay: ranked.riteDay,
      presiding: ranked.presiding,
      handle: ranked.handle,
      displayName: ranked.displayName,
    })
    .from(ranked)
    .where(eq(ranked.rank, 1))

  const crownings = new Map<string, Crowning>()
  for (const r of rows) {
    const lens = riteLensSchema.parse(r.lens)
    crownings.set(r.postId, {
      lens,
      mark: markFor(lens),
      riteDay: r.riteDay,
      // NAME ALWAYS: a present persona supplies its display name + handle; an absent
      // one (retired, or the system host) falls back to its agentId as the label.
      presiding: {
        handle: r.handle,
        displayName: r.displayName ?? r.presiding,
      },
    })
  }
  return crownings
}
