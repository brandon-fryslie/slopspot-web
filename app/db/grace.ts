// [LAW:single-enforcer] The one module that reads and writes the graces table — the Patronage's
// citizen→human edge (slopspot-patronage-ts7.8). Three responsibilities, one home: BUILD the corpus the
// pure chooser folds (readGraceCorpus), RECORD a grace as fact (recordGrace), and read back the grace a
// day settled (graceForDay, the idempotency-recovery read). The choice logic itself is pure and lives in
// lib/grace.ts (chooseGrace); this module is its I/O boundary — exactly the crowns.ts ↔ lib/rite.ts split.
//
// [LAW:one-way-deps] grace(db) → db/client, db/schema, db/attribution (the ONE author-principal
// expression), lib/grace (the corpus type + fold), lib/domain. It NEVER imports db/backings — the prayer
// is a separate edge grace does not read. This blindness is enforced two ways at once: the GraceCorpus
// type carries no field a backing could occupy (lib/grace), and this reader's query joins votes ⋈
// authorship ⋈ personas only — the backings table is never in a FROM/JOIN here. The orthogonality test
// (mirroring ts7.4) drives this exact reader at 0 vs N backers and demands the corpus is byte-identical.
//
// [LAW:one-source-of-truth] The "chosen" mark a human or slop might carry is NEVER a stored flag — there
// is no is_chosen column; a chosen-ness surface (ts7.9/.10) derives it from a row here at read time, the
// same shape crowns' mark and score=SUM(votes) take.

import { and, asc, eq, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { db } from '~/db/client'
import { principalExpr } from '~/db/attribution'
import { generations, graces, personas, posts, votes } from '~/db/schema'
import { AgentId, PostId } from '~/lib/domain'
import type { GraceCorpus, GraceEdge } from '~/lib/grace'

// [LAW:single-enforcer] BUILD the corpus the chooser folds — the eligible engagement edges. An edge is a
// vote BY A HUMAN on a GENERATION slop AUTHORED BY A CITIZEN. The three constraints are the whole
// eligibility, each expressed in the query so an illegal edge is never assembled:
//   - posts.contentKind = 'generation' — grace attaches to a made slop, not an upload or a found link.
//   - the author is a REAL citizen persona (INNER JOIN on the author-principal expression) — so the
//     chooser (a speaker in ts7.9) is a citizen with a voice, never the FK-less system cron 'sys:slop-cron'.
//   - the voter is NOT a persona (LEFT JOIN personas, voter side IS NULL) — a "human" is an anon voter, the
//     same human↔citizen distinction the populist niche draws (db/genepool.ts).
//
// [LAW:caches-are-derived] The author is read through principalExpr('author') — the ONE definition of
// "whose post is this" (db/attribution.ts), the literal-json expression migration 0033's index serves — so
// grace can never disagree with the Cast deed counts about a slop's maker. ORDER BY (post_id, voter_id) is
// a TOTAL order over the vote PK, so the edge list is stable and the chooser's hash-pick is reproducible
// (the listPersonas ORDER BY agent_id discipline). [LAW:dataflow-not-control-flow] An empty city yields []
// — the chooser reads that as `barren` by data, never a thrown or skipped branch.
export async function readGraceCorpus(env: Env): Promise<GraceCorpus> {
  const authorExpr = principalExpr('author')
  const voterPersona = alias(personas, 'grace_voter_persona')
  const authorPersona = alias(personas, 'grace_author_persona')

  const rows = await db(env)
    .select({
      citizen: authorPersona.agentId,
      human: votes.voterId,
      postId: votes.postId,
    })
    .from(votes)
    .innerJoin(posts, and(eq(posts.id, votes.postId), eq(posts.contentKind, 'generation')))
    // The author is a citizen: join the personas row whose agentId IS the post's author-principal.
    .innerJoin(authorPersona, eq(authorPersona.agentId, authorExpr))
    // The voter is a human: no personas row carries its id.
    .leftJoin(voterPersona, eq(voterPersona.agentId, votes.voterId))
    .where(isNull(voterPersona.agentId))
    .orderBy(asc(votes.postId), asc(votes.voterId))

  const edges: GraceEdge[] = rows.map((r) => ({
    citizen: AgentId(r.citizen),
    human: r.human,
    postId: PostId(r.postId),
  }))
  return { edges }
}

// What recordGrace persists: the choosing citizen, the chosen human, the made-thing the grace attaches to,
// and the UTC day it fell (the UNIQUE idempotency slot). createdAt is stamped by the writer.
export type GraceRecord = {
  citizen: AgentId
  human: string
  postId: PostId
  graceDay: string
}

// The grace a day settled, read back — the choice as fact (no derived mark; surfaces derive elsewhere).
export type StoredGrace = {
  citizen: AgentId
  human: string
  postId: PostId
}

// [LAW:types-are-the-program] recordGrace has two real outcomes: the grace was recorded, or the day had
// already settled a grace — and in the latter case it returns the grace that IS there, so a re-fire reports
// the authoritative edge rather than the caller's discarded re-choice. The UNIQUE(grace_day) index makes
// "at most one grace per day" unrepresentable in storage; idempotency is by construction. Mirrors
// recordCrowning one-for-one.
export type RecordGraceResult =
  | { recorded: true; id: string }
  | { recorded: false; existing: StoredGrace }

// [LAW:single-enforcer] The one reader of "the grace that settled this day" — serves recordGrace's
// conflict-recovery (and any later settled-day short-circuit). Returns null when the day is unsettled.
export async function graceForDay(env: Env, graceDay: string): Promise<StoredGrace | null> {
  const rows = await db(env)
    .select({ citizen: graces.citizen, human: graces.human, postId: graces.postId })
    .from(graces)
    .where(eq(graces.graceDay, graceDay))
    .limit(1)
  if (rows.length === 0) return null
  const r = rows[0]
  return { citizen: AgentId(r.citizen), human: r.human, postId: PostId(r.postId) }
}

// [LAW:make-it-impossible] What the third-person reveal (ts7.9) needs to render the citizen's line — and
// NOTHING THE HUMAN COULD BE NAMED BY. The maker's display name (the speaker) and the made-thing's prompt
// (the subject the chosen keeps returning to); the chosen human is NEVER selected, so the reveal this feeds
// has no human identifier in scope — the same discipline readGraceCorpus holds against backings, here held
// against the chosen's identity. The reveal DAWNS because the data it is built from withholds the name.
export type GraceRevealData = {
  readonly citizen: AgentId
  readonly makerName: string
  readonly slop: { readonly postId: PostId; readonly prompt: string }
}

// [LAW:single-enforcer] The grace SURFACE derivation — the made-thing + its maker, for a recorded grace
// edge. generations.utterance is the canonical composed prompt (the subject the line hangs on); the INNER
// JOINs require the maker to be a real persona AND the made-thing to be a generation, so a vanished post or
// an FK-less system author yields null (best-effort narration skips it, never throws — the grace stays
// recorded). [LAW:one-way-deps] returns plain data; the voice target (GraceChoice) is assembled in the
// agent layer, which owns the presentation type.
export async function readGraceReveal(env: Env, edge: GraceEdge): Promise<GraceRevealData | null> {
  const rows = await db(env)
    .select({ makerName: personas.displayName, prompt: generations.utterance })
    .from(generations)
    // The maker is the choosing citizen — a constant-keyed INNER JOIN: no maker persona, no reveal.
    .innerJoin(personas, eq(personas.agentId, edge.citizen))
    .where(eq(generations.postId, edge.postId))
    .limit(1)
  if (rows.length === 0) return null
  const r = rows[0]
  return { citizen: edge.citizen, makerName: r.makerName, slop: { postId: edge.postId, prompt: r.prompt } }
}

// [LAW:single-enforcer][LAW:types-are-the-program] The one writer of a grace row. The UNIQUE(grace_day)
// index IS the one-grace-per-day invariant; onConflictDoNothing makes a concurrent or retried re-fire
// converge on it without throwing, and RETURNING discriminates the outcome at the single statement — a
// returned row means THIS call recorded the grace, an empty result means the day was already settled. No
// check-then-insert TOCTOU. Mirrors recordCrowning.
export async function recordGrace(env: Env, input: GraceRecord): Promise<RecordGraceResult> {
  const id = `grace:${crypto.randomUUID()}`
  const inserted = await db(env)
    .insert(graces)
    .values({
      id,
      citizen: input.citizen,
      human: input.human,
      postId: input.postId,
      graceDay: input.graceDay,
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: graces.graceDay })
    .returning({ id: graces.id })
  if (inserted.length === 0) {
    const existing = await graceForDay(env, input.graceDay)
    if (existing === null) {
      throw new Error(`grace: grace day ${input.graceDay} conflicted yet has no grace`)
    }
    return { recorded: false, existing }
  }
  return { recorded: true, id: inserted[0].id }
}
