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

import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { crowns, generations, personas, posts, votes } from '~/db/schema'
import type { AgentId, Crowning, PostId, VoteValue } from '~/lib/domain'
import {
  ballotCitizens,
  markFor,
  riteLensSchema,
  type RiteBallot,
  type RiteCandidate,
  type RiteLens,
  type RiteWindow,
} from '~/lib/rite'
import { utteranceSchema, type Utterance } from '~/lib/voice'

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

// The settled crown for a rite day — what was actually crowned, read back. The
// decree is the whole stored Utterance (spoke or a meant silence), authored once and
// never re-voiced on a re-fire.
export type StoredCrowning = {
  postId: PostId
  lens: RiteLens
  decree: Utterance
}

// [LAW:types-are-the-program] recordCrowning has two real outcomes: the crown was
// recorded, or the day was already crowned — and in the latter case it returns the
// crown that IS there, so a re-fire reports the authoritative crown rather than the
// caller's discarded re-election. The UNIQUE(rite_day) index makes "one ceremony per
// day" unrepresentable in storage; idempotency is by construction.
export type RecordCrowningResult =
  | { recorded: true; id: string }
  | { recorded: false; existing: StoredCrowning }

// [LAW:no-silent-fallbacks] decree_json is validated at this storage boundary against
// the Utterance schema — a malformed JSON string, a `null`, a missing field, or a bad
// withheld-reason fails loud with the day for context, never a laundered cast that
// would explode later at the first `.kind`. Mirrors feed.ts's storage-boundary parses.
function parseDecree(json: string, riteDay: string): Utterance {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    throw new Error(`crowns: malformed decree_json for rite day ${riteDay}`, { cause: err })
  }
  const parsed = utteranceSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(
      `crowns: decree_json for rite day ${riteDay} is not a valid Utterance: ${parsed.error.message}`,
    )
  }
  return parsed.data
}

// [LAW:single-enforcer] The one reader of "the crown that settled this day." Serves
// both the orchestrator's settled-day short-circuit and recordCrowning's
// conflict-recovery, so the rite_day → crown read lives in exactly one place.
export async function crowningForDay(
  env: Env,
  riteDay: string,
): Promise<StoredCrowning | null> {
  const rows = await db(env)
    .select({
      postId: crowns.postId,
      lens: crowns.lens,
      decreeJson: crowns.decreeJson,
    })
    .from(crowns)
    .where(eq(crowns.riteDay, riteDay))
    .limit(1)
  if (rows.length === 0) return null
  const r = rows[0]
  return {
    postId: r.postId as PostId,
    lens: riteLensSchema.parse(r.lens),
    decree: parseDecree(r.decreeJson, riteDay),
  }
}

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
    // The day was already crowned (a race between a settled-check and this insert).
    // Return the crown that IS there so the caller reports the authoritative result.
    const existing = await crowningForDay(env, input.riteDay)
    if (existing === null) {
      throw new Error(`crowns: rite day ${input.riteDay} conflicted yet has no crown`)
    }
    return { recorded: false, existing }
  }
  return { recorded: true, id: inserted[0].id }
}

// [LAW:dataflow-not-control-flow] The rite reads the DAY's votes that ALREADY exist —
// no new mechanic, and bounded to `window` (the 24h before the ceremony) so the
// ballot is the day's judgment, never the all-time favourite. The candidate shape
// carries the day's overallScore (the acclaim ballot's read + the "strongest"
// tiebreak) and the ballot citizens' own votes (what the sole/feud ballots nominate
// from). The BALLOT decides which posts are gathered: for sole/feud the candidates are
// the slops the ballot's citizens voted on IN THE WINDOW (a monarchical nomination —
// the city's loudest post is NOT a candidate unless a presiding citizen voted for it);
// for acclaim it is every slop judged in the window. The window is over votes.created_at
// (a vote's time, not a post's), so a citizen blessing an OLD slop today still
// nominates it — exactly how a Relic is resurrected.
// [LAW:one-source-of-truth] The placard is NOT gathered here — it is derived in one
// place (the feed reader's toContent); the orchestrator re-reads the WINNER through it.
export async function gatherCandidates(
  env: Env,
  ballot: RiteBallot,
  window: RiteWindow,
): Promise<RiteCandidate[]> {
  const database = db(env)
  const inWindow = and(
    gte(votes.createdAt, new Date(window.sinceMs)),
    lt(votes.createdAt, new Date(window.untilMs)),
  )

  // The day's city score per succeeded generation the city judged within the window.
  const scoreRows = await database
    .select({
      postId: generations.postId,
      score: sql<number>`sum(${votes.value})`,
    })
    .from(generations)
    .innerJoin(posts, eq(posts.id, generations.postId))
    .innerJoin(votes, eq(votes.postId, generations.postId))
    .where(and(eq(generations.status, 'succeeded'), inWindow))
    .groupBy(generations.postId)
  const scoreByPost = new Map(scoreRows.map((r) => [r.postId, r.score]))

  const citizens = ballotCitizens(ballot)
  if (citizens.length === 0) {
    // acclaim: every slop judged in the window is a candidate; no citizen ballot.
    return scoreRows.map((r) => ({
      postId: r.postId as PostId,
      overallScore: r.score,
      citizenVotes: {},
    }))
  }

  // sole/feud: the candidates are the slops the ballot's citizens voted on IN THE
  // WINDOW — their own daily ballot. A slop no ballot citizen blessed today cannot be
  // nominated, however loud the rest of the city is.
  const citizenRows = await database
    .select({ postId: votes.postId, voterId: votes.voterId, value: votes.value })
    .from(votes)
    .innerJoin(
      generations,
      and(eq(generations.postId, votes.postId), eq(generations.status, 'succeeded')),
    )
    .where(and(inArray(votes.voterId, [...citizens]), inWindow))
  const byPost = new Map<string, Record<string, VoteValue>>()
  for (const r of citizenRows) {
    const m = byPost.get(r.postId) ?? {}
    m[r.voterId] = r.value as VoteValue
    byPost.set(r.postId, m)
  }
  return [...byPost.entries()].map(([postId, citizenVotes]) => ({
    postId: postId as PostId,
    overallScore: scoreByPost.get(postId) ?? 0,
    citizenVotes,
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
