// [LAW:single-enforcer] The one place a backing row is written or removed, and the
// one place a citizen's backer count + a viewer's backed-state are read. Every
// allegiance mutation funnels through `setBacking`; every Cast surface reads its
// counts through `getBackings`. The duplicate-pledge guard, the handle→citizen
// resolution, and the derived count all live here so no callsite re-derives them.
//
// [LAW:one-source-of-truth] A citizen's backer count is COUNT(backing rows) at
// read time — never a stored tally. Same shape score=SUM(votes.value) takes in
// votes.ts and feed.ts: the rows are the only representation, computed on read.
//
// [LAW:types-are-the-program] The backing edge stores the STABLE agentId, not the
// nullable/mutable URL handle. The handle is a write-boundary concern (the URL the
// human clicked); setBacking resolves it once, here, and stores the being's one
// immutable identity. A backing keyed by handle would break the moment a handle
// re-mints — an illegal state this module makes unrepresentable by construction.

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { backings } from '~/db/schema'
import { getPersonaByHandle } from '~/agents/persona'
import type { AgentId } from '~/lib/domain'

export type SetBackingInput = {
  // The citizen's canonical URL key — the handle the human clicked. setBacking
  // resolves it to the stable agentId it stores. Backing is addressed the way
  // every /cast surface is: by handle, never by the internal agentId.
  handle: string
  voterId: string
  // [LAW:types-are-the-program] The DESIRED state, not a flip — `true` pledges,
  // `false` withdraws. Carrying the target state (rather than "toggle whatever is
  // there") makes the write idempotent and retry-safe: the same request twice
  // lands the same row state. Mirrors VoteIntent carrying the target vote.
  backed: boolean
}

// [LAW:types-are-the-program] Two real outcomes — the backing applied (with the
// now-current derived count and viewer state for the optimistic UI to reconcile
// against), or the handle resolves to no citizen. Lifting "unknown citizen" into a
// discriminated return makes the route's HTTP mapping mechanical: 200 on `ok`, 404
// on `citizen_not_found`. Mirrors SetVoteResult exactly.
export type SetBackingResult =
  | { ok: true; backerCount: number; backed: boolean }
  | { ok: false; reason: 'citizen_not_found' }

// [LAW:dataflow-not-control-flow] Same shape every call: resolve the citizen, then
// write (or remove) the row, then read the new count. The `backed` discriminator
// decides which SQL statement runs; both arms terminate at the same "count the
// backers" step. The empty-`else` "skip" shape is avoided — a withdraw is a real
// DELETE, not a no-op.
export async function setBacking(
  input: SetBackingInput,
  ctx: { env: Env },
): Promise<SetBackingResult> {
  const { handle, voterId, backed } = input
  const database = db(ctx.env)

  // [LAW:single-enforcer] The citizen-existence check is the writer's
  // responsibility — the route stays HTTP-shape only, mirroring setVote's
  // post-existence pre-check. An unknown/unminted handle is the one non-I/O
  // failure mode, surfaced as a discriminated result the route maps to 404.
  const persona = await getPersonaByHandle(ctx.env, handle)
  if (persona === null) {
    return { ok: false, reason: 'citizen_not_found' }
  }
  const citizen = persona.agentId

  if (backed) {
    // [LAW:types-are-the-program] onConflictDoNothing makes the pledge idempotent
    // against the (voter_id, citizen) PK: re-backing is a silent no-op, not a
    // duplicate row and not an error. created_at stays the FIRST pledge's time —
    // "backed him before the saints" is the original moment, not the last click.
    await database
      .insert(backings)
      .values({ voterId, citizen, createdAt: new Date() })
      .onConflictDoNothing({ target: [backings.voterId, backings.citizen] })
  } else {
    await database
      .delete(backings)
      .where(and(eq(backings.voterId, voterId), eq(backings.citizen, citizen)))
  }

  return {
    ok: true,
    backerCount: await backerCountFor(database, citizen),
    backed,
  }
}

// [LAW:one-source-of-truth] The count of a single citizen's backers — COUNT(rows),
// the same coalesce-to-zero shape scoreFor takes for one post. Takes the already
// constructed DB instance so setBacking counts on its own database; external
// callers pass theirs.
async function backerCountFor(
  database: ReturnType<typeof db>,
  citizen: AgentId,
): Promise<number> {
  const rows = await database
    .select({ count: sql<number>`count(*)` })
    .from(backings)
    .where(eq(backings.citizen, citizen))
  // count(*) always returns exactly one row — no defensive guard needed.
  return rows[0].count
}

// [LAW:types-are-the-program] The Cast surfaces' read shape: per citizen, the
// derived backer count AND whether THIS viewer backs them. The same bundling
// RenderablePost does for score+myVote — the count is global, viewerBacks is
// viewer-specific, and both are read together so a card has one source of truth
// for its button.
export type CitizenBacking = { backerCount: number; viewerBacks: boolean }

// [LAW:single-enforcer] The one read for the Cast surfaces — the roster passes its
// whole roster of agentIds (one batched read, not one-per-card), the shrine passes
// a single-element array. Both the count and the viewer flag come from ONE GROUP BY
// (mirroring feed.ts computing score+myVote in one read), so a roster of N citizens
// costs one query, not 2N.
export async function getBackings(
  env: Env,
  citizens: AgentId[],
  // [LAW:no-defensive-null-guards] Optionality is real here: a first-time visitor
  // has no voter cookie yet (readVoterId returns undefined). That is not a guard to
  // skip work — it is the data state "this viewer backs no one," which the SQL
  // expresses with a sentinel that matches no real UUID voter_id (the same
  // empty-string sentinel feed.ts uses for its myVote LEFT JOIN).
  viewerId: string | undefined,
): Promise<Map<string, CitizenBacking>> {
  // inArray([]) generates invalid `IN ()` SQL — an empty city is a real state
  // (no personas), so short-circuit to an empty map. Mirrors voterStats' guard.
  if (citizens.length === 0) return new Map()

  const viewer = viewerId ?? ''
  const rows = await db(env)
    .select({
      citizen: backings.citizen,
      count: sql<number>`count(*)`,
      // 1 iff a row for THIS viewer exists in the citizen's group, else 0. max()
      // over the group collapses "does any row match the viewer" to a single flag.
      mine: sql<number>`max(case when ${backings.voterId} = ${viewer} then 1 else 0 end)`,
    })
    .from(backings)
    .where(inArray(backings.citizen, citizens))
    .groupBy(backings.citizen)

  // [LAW:dataflow-not-control-flow] A citizen with no backers is absent from the
  // GROUP BY result — that absence IS the data state {0, false}, filled here so the
  // map total over the requested citizens and the renderer never branches on a
  // missing key. Build from the rows, then default the un-backed remainder.
  const result = new Map<string, CitizenBacking>(
    rows.map((r) => [r.citizen, { backerCount: r.count, viewerBacks: r.mine === 1 }]),
  )
  for (const citizen of citizens) {
    if (!result.has(citizen)) result.set(citizen, { backerCount: 0, viewerBacks: false })
  }
  return result
}
