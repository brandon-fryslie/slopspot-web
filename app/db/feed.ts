// [LAW:single-enforcer] The read side of D1 for posts. The inverse of
// createPost (app/db/posts.ts): createPost switches on the status it writes and
// sets that arm's columns; this module switches on the status it reads and
// pulls that arm's columns. Same discriminators, opposite direction.
//
// Three readers live here because they share the same row→Post mapping
// (toPost/toContent/toStatus): getFeed for the homepage list (with score,
// commentCount, myVote aggregates), getFeedItemById for the permalink page
// (same aggregates, narrowed to one post by id), and getPostById for the
// fork form's parent-recipe fetch (no aggregates — the form does not render
// score/comments). Splitting them into separate files would duplicate the
// mapping or force an export-just-for-share — instead they share the helpers
// in-module.
//
// [LAW:types-are-the-program] FeedItem is the smooth seam between storage and
// rendering (app/lib/domain.ts). This module's whole job is to absorb the
// impedance between the storage shape (D1 columns are independently nullable; the
// vote score is a separate aggregate) and the domain shape (Content/GenerationStatus
// are closed discriminated unions). Everything below is the residue of that one map.

import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { db } from '~/db/client'
import {
  comments,
  found,
  generations,
  posts,
  uploads,
  votes,
  type DbFound,
  type DbGeneration,
  type DbPost,
  type DbUpload,
} from '~/db/schema'
import {
  PostId,
  ProviderId,
  type Actor,
  type Content,
  type FeedItem,
  type GenerationStatus,
  type Media,
  type Origin,
  type Post,
  type RenderablePost,
  type VoteValue,
} from '~/lib/domain'
import { emit } from '~/observability/metrics'
import {
  aspectRatioSchema,
  recipeSubjectSchema,
  styleFamilySchema,
  type RecipeSubject,
} from '~/lib/variety'

// One flat join row. The sibling tables are nullable because the DB does not
// enforce cross-table cardinality (that is createPost's transactional invariant);
// contentKind is the discriminator that says which sibling is the real one.
type FeedRow = {
  post: DbPost
  generation: DbGeneration | null
  upload: DbUpload | null
  found: DbFound | null
}

// [LAW:types-are-the-program] The storage→domain trust boundary. Columns carry the
// weaker storage type (T | null); the domain type is stronger (T). A null where the
// domain forbids one means storage violated an invariant — the generations_status_shape
// CHECK, or createPost's sibling-row cardinality. Fail loud here rather than launder it
// with `!`, which would let null silently corrupt a domain object downstream.
// [LAW:no-silent-fallbacks] explicit throw, not a skipped row.
function required<T>(value: T | null, what: string): T {
  if (value === null) {
    throw new Error(`feed: expected ${what} to be present in storage`)
  }
  return value
}

// The dual of `required`: the sibling table NOT named by contentKind must be empty.
// Together they assert exactly-one-sibling — a row that maps to two Content arms is
// ambiguous and must fail loud, not silently pick one. [LAW:no-silent-fallbacks]
function absent(value: unknown, what: string): void {
  if (value !== null) {
    throw new Error(`feed: unexpected ${what} present in storage`)
  }
}

// [LAW:single-enforcer] Sibling-row check for the contentKind discriminator —
// the SAME class of violation that produced the slopspot-prod-data-so2 outage
// (43/43 posts orphan, homepage 500). The fail-loud is `required`'s job; this
// wrapper adds the metric emission so the puller (homelab) can alert on a
// non-zero orphan rate long before users notice. The metric fires BEFORE the
// throw so even an immediately-handled re-throw still leaves a counter
// breadcrumb. [LAW:dataflow-not-control-flow] same code path every call; the
// emit is unconditional inside the null arm, never gated by an environment
// flag.
function requiredSibling<T>(
  value: T | null,
  contentKind: 'generation' | 'found' | 'upload',
  postId: string,
): T {
  if (value === null) {
    emit('slopspot.write.orphan_detected', { content_kind: contentKind }, 1)
    throw new Error(
      `feed: expected ${contentKind} sibling row for post ${postId} but storage has none`,
    )
  }
  return value
}

// [LAW:types-are-the-program] Exhaustiveness guard for the status discriminator.
// In the default arm `value` narrows to `never`, so this compiles only while every
// arm is handled — add a status to the schema enum and the reader stops compiling
// until updated. At runtime it doubles as the boundary's fail-loud guard for a
// status no CHECK should have admitted. [LAW:no-silent-fallbacks]
function assertNever(value: never, what: string): never {
  throw new Error(`feed: unexpected ${what} at storage boundary: ${String(value)}`)
}

// JSON columns hold exactly what createPost serialized — our own shapes, not foreign
// input — so this is a typed deserialize, not a defensive re-parse. A malformed column
// is the same class of storage violation as `required`/`absent` guard, so it fails loud
// the same way: localize responsibility to the column/post rather than surfacing a
// context-free SyntaxError. [LAW:no-silent-fallbacks]
function parseJson<T>(json: string, what: string): T {
  try {
    return JSON.parse(json)
  } catch (err) {
    throw new Error(`feed: malformed JSON in ${what}`, { cause: err })
  }
}

// [LAW:types-are-the-program] Closed union → exhaustive switch, mirroring PostCard.
// Unlike PostCard (which consumes an already-constructed domain object), this runs at
// the storage boundary on a raw column, so the default arm asserts-never: it keeps the
// compile-time exhaustiveness check AND fails loud at runtime on a status the CHECK
// should never have admitted.
function toStatus(g: DbGeneration): GenerationStatus {
  switch (g.status) {
    case 'pending':
      return { kind: 'pending', queuedAt: required(g.queuedAt, 'pending.queuedAt') }
    case 'running':
      return { kind: 'running', startedAt: required(g.startedAt, 'running.startedAt') }
    case 'succeeded':
      return {
        kind: 'succeeded',
        output: parseJson<Media>(
          required(g.outputJson, 'succeeded.outputJson'),
          `output_json for post ${g.postId}`,
        ),
        completedAt: required(g.completedAt, 'succeeded.completedAt'),
      }
    case 'failed':
      return {
        kind: 'failed',
        reason: required(g.failedReason, 'failed.failedReason'),
        failedAt: required(g.failedAt, 'failed.failedAt'),
      }
    default:
      return assertNever(g.status, `status for post ${g.postId}`)
  }
}

// [LAW:types-are-the-program] Reconstruct the RecipeSubject discriminated union
// from the flattened storage columns. recipeSubjectSchema enforces that the
// slots JSON object's keys match exactly what the subject_template variant
// requires — so a row where (subject_template, slots_json) drifted (e.g.
// 'T05' with only `setting`, missing `timeOfDay`) fails loud here, the way
// a missing-column violation does in `required`. [LAW:no-silent-fallbacks]
function toRecipeSubject(
  subjectTemplate: string,
  slotsJson: string,
  postId: string,
): RecipeSubject {
  const slots = parseJson<unknown>(slotsJson, `slots_json for post ${postId}`)
  const parsed = recipeSubjectSchema.safeParse({ subjectTemplate, slots })
  if (!parsed.success) {
    throw new Error(
      `feed: malformed recipe subject for post ${postId}: ${parsed.error.message}`,
    )
  }
  return parsed.data
}

// [LAW:types-are-the-program] Closed union → exhaustive switch on the storage
// discriminator. Adding a new variant to posts.contentKind upstream forces
// this switch to grow before it compiles, matching the [LAW:single-enforcer]
// shape: one place reads each arm. The default branch's assertNever doubles
// as the runtime fail-loud for a contentKind no CHECK should have admitted.
// [LAW:no-silent-fallbacks]
function toContent(row: FeedRow): Content {
  switch (row.post.contentKind) {
    case 'upload': {
      absent(row.generation, `generations row for upload post ${row.post.id}`)
      absent(row.found, `found row for upload post ${row.post.id}`)
      const u = requiredSibling(row.upload, 'upload', row.post.id)
      return {
        kind: 'upload',
        asset: parseJson<Media>(u.assetJson, `asset_json for post ${row.post.id}`),
      }
    }
    case 'found': {
      absent(row.generation, `generations row for found post ${row.post.id}`)
      absent(row.upload, `uploads row for found post ${row.post.id}`)
      const f = requiredSibling(row.found, 'found', row.post.id)
      const thumbnail =
        f.thumbnailJson === null
          ? undefined
          : parseJson<Media>(f.thumbnailJson, `thumbnail_json for post ${row.post.id}`)
      return {
        kind: 'found',
        url: f.url,
        title: f.title,
        ...(f.description !== null ? { description: f.description } : {}),
        ...(thumbnail !== undefined ? { thumbnail } : {}),
      }
    }
    case 'generation': {
      absent(row.upload, `uploads row for generation post ${row.post.id}`)
      absent(row.found, `found row for generation post ${row.post.id}`)
      const g = requiredSibling(row.generation, 'generation', row.post.id)
      // Variety fields at the trust boundary: Zod literal-union parses fail loud on
      // any storage value outside the documented enums (style family or aspect
      // ratio that no longer exists, mis-typed). [LAW:no-silent-fallbacks]
      const styleFamily = styleFamilySchema.parse(g.styleFamily)
      const aspectRatio = aspectRatioSchema.parse(g.aspectRatio)
      const subject = toRecipeSubject(g.subjectTemplate, g.slotsJson, g.postId)
      return {
        kind: 'generation',
        recipe: {
          providerId: ProviderId(g.providerId),
          providerVersion: g.providerVersion,
          params: parseJson<unknown>(g.paramsJson, `params_json for post ${g.postId}`),
          styleFamily,
          aspectRatio,
          subject,
          parentId: g.parentPostId === null ? undefined : PostId(g.parentPostId),
        },
        status: toStatus(g),
      }
    }
    default:
      return assertNever(row.post.contentKind, `contentKind for post ${row.post.id}`)
  }
}

// [LAW:types-are-the-program] Anti-corruption layer for legacy rows written before
// the Actor union gained the 'anon' variant. Fork submissions prior to this change
// stored { kind: 'agent', agentId: 'anon-XXXXXX' }. Normalizing at the read
// boundary keeps the domain pure — callers never see the legacy shape.
//
// The predicate matches exactly the output of authorLabel(uuid): 'anon-' + the
// first 6 chars of a UUID (hex digits; case-insensitive because voter IDs may
// originate from any UUID source, not just crypto.randomUUID()). Tighter than
// startsWith('anon-') alone to avoid misclassifying a self-reported agentId.
const LEGACY_ANON_RE = /^anon-[0-9a-f]{6}$/i
function normalizeActor(raw: Actor): Actor {
  if (raw.kind === 'agent' && LEGACY_ANON_RE.test(raw.agentId)) {
    return { kind: 'anon', label: raw.agentId }
  }
  return raw
}

function normalizeOrigin(raw: Origin): Origin {
  return {
    actor: normalizeActor(raw.actor),
    ...(raw.onBehalfOf !== undefined ? { onBehalfOf: normalizeActor(raw.onBehalfOf) } : {}),
  }
}

function toPost(row: FeedRow): Post {
  return {
    id: PostId(row.post.id),
    createdAt: row.post.createdAt,
    origin: normalizeOrigin(parseJson<Origin>(row.post.originJson, `origin_json for post ${row.post.id}`)),
    content: toContent(row),
  }
}

// [LAW:types-are-the-program] The schema's votes_value_shape CHECK guarantees a
// stored value is exactly -1 or 1; SQL returns it as `number`. This is the
// boundary translation back to VoteValue. A row that came back as something
// other than -1/1 means the CHECK was bypassed — fail loud, do not coerce.
function toMyVote(raw: number | null, postId: string): VoteValue | null {
  if (raw === null) return null
  if (raw === 1 || raw === -1) return raw
  throw new Error(
    `feed: vote value ${raw} for post ${postId} is outside the stored shape (-1 | 1)`,
  )
}

// [LAW:single-enforcer] [LAW:one-source-of-truth] One definition of the
// vote-score aggregate. The SUM/GROUP BY/alias is identical between phase 1
// (rank candidates by score) and phase 2 (project per-row scores into the
// FeedItem). The `filter` parameter is the *value* that distinguishes them —
// undefined for phase 1 (aggregate over every vote, needed to rank all posts);
// `inArray(votes.postId, ids)` for phase 2 (aggregate bounded to visible
// posts). [LAW:dataflow-not-control-flow] — same code runs every call; the
// caller's filter value is what changes. Drizzle's `.where(undefined)` is a
// no-op (no WHERE emitted), so passing undefined is the data-flow expression
// of "no filter."
function voteScoreSubquery(database: ReturnType<typeof db>, filter: SQL | undefined) {
  const voteScore = database
    .select({
      postId: votes.postId,
      score: sql<number>`sum(${votes.value})`.as('score'),
    })
    .from(votes)
    .where(filter)
    .groupBy(votes.postId)
    .as('vote_score')

  const score = sql<number>`coalesce(${voteScore.score}, 0)`

  return { voteScore, score }
}

// [LAW:single-enforcer] One place defines the FeedItem-shaped rowset's joins,
// aggregates, and column selection. Both readers (getFeed and getFeedItemById)
// build their queries from this helper, so any aggregate change (new column,
// different COALESCE, a future per-post stat) lands in both views by
// construction — no drift risk.
//
// [LAW:types-are-the-program] The `ids` parameter is the visible post set —
// the strongest true theorem about a per-post aggregate is "aggregate over
// sibling rows whose post_id is in the visible set." Lifting that constraint
// into each aggregate's WHERE makes the SUM/COUNT bounded by the caller's
// narrowing instead of scanning the whole sibling table and then joining late.
// The outer SELECT also filters by `posts.id IN (ids)`, so a single value
// (ids) determines visibility for both the row set and every aggregate over
// it. [LAW:one-source-of-truth] — no parallel "visible set" definitions to
// drift.
//
// [LAW:one-source-of-truth] Score is SUM(votes.value), never a stored column.
// commentCount is COUNT(comments) per post, derived the same way. The LEFT
// JOIN + COALESCE shapes make a post with no votes / no comments still appear
// with a numeric zero, rather than dropping out or yielding NULL downstream.
//
// [LAW:dataflow-not-control-flow] The JOIN to the viewer's own vote runs every
// call, regardless of whether a voter id is known. The sentinel when voterId
// is absent ('') cannot match any real UUID, so the LEFT JOIN simply yields
// null for every row — same query shape, the data decides what matches.
// Empty `ids` is handled by Drizzle's `inArray(_, [])` → `WHERE false`, so the
// helper degrades to "no rows" by data rather than by an early-return branch.
//
// The return shape includes `score` separately because callers need it as a
// SQL expression for ordering (getFeed orders by it) — separate from the
// per-row scalar projected into the SELECT.
function selectFeedRows(
  database: ReturnType<typeof db>,
  ids: readonly string[],
  voterId: string | undefined,
) {
  const { voteScore, score } = voteScoreSubquery(database, inArray(votes.postId, ids))

  const commentCount = database
    .select({
      postId: comments.postId,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(comments)
    .where(inArray(comments.postId, ids))
    .groupBy(comments.postId)
    .as('comment_count')

  const cCount = sql<number>`coalesce(${commentCount.count}, 0)`

  const myVote = alias(votes, 'my_vote')
  const myVoterId = voterId ?? ''

  const query = database
    .select({
      post: posts,
      generation: generations,
      upload: uploads,
      found,
      score,
      myVote: myVote.value,
      commentCount: cCount,
    })
    .from(posts)
    .leftJoin(generations, eq(generations.postId, posts.id))
    .leftJoin(uploads, eq(uploads.postId, posts.id))
    .leftJoin(found, eq(found.postId, posts.id))
    .leftJoin(voteScore, eq(voteScore.postId, posts.id))
    .leftJoin(commentCount, eq(commentCount.postId, posts.id))
    .leftJoin(
      myVote,
      and(eq(myVote.postId, posts.id), eq(myVote.voterId, myVoterId)),
    )
    .where(inArray(posts.id, ids))
    .$dynamic()

  return { query, score }
}

// [LAW:single-enforcer] One row → one RenderablePost. Both readers funnel
// through this so the per-row construction of the four-field renderable
// shape lives in exactly one place. The feed reader spreads its output and
// adds `rank` (the only field unique to list-position views); the permalink
// reader returns it bare. The variability between "ranked" and "bare"
// renderable lives in the caller, not in a parameter to this helper —
// [LAW:dataflow-not-control-flow], the function does the same thing every
// time, the caller decides whether to augment.
type FeedRowWithAggregates = {
  post: DbPost
  generation: DbGeneration | null
  upload: DbUpload | null
  found: DbFound | null
  score: number
  myVote: number | null
  commentCount: number
}

function rowToRenderablePost(row: FeedRowWithAggregates): RenderablePost {
  return {
    post: toPost(row),
    score: row.score,
    myVote: toMyVote(row.myVote, row.post.id),
    commentCount: row.commentCount,
  }
}

// [LAW:one-source-of-truth] A CTE defines the visible post set exactly once.
// The votes and comments aggregate subqueries reference it via `SELECT id FROM
// feed_ids` — a SQL subquery, not a bind-param list. The previous two-phase
// design (pickFeedIds → selectFeedRows) re-passed the same 50 ids as bind
// params three times (votes IN, comments IN, WHERE IN = 151 params), exceeding
// D1's 100-variable limit as the post count grew past ~32.
//
// `desc(posts.id)` is the deterministic tie-breaker for equal score+createdAt.
export async function getFeed(
  env: Env,
  voterId?: string,
): Promise<FeedItem[]> {
  const database = db(env)

  const { voteScore: rankVoteScore, score: rankScore } = voteScoreSubquery(database, undefined)

  const feedIds = database.$with('feed_ids').as(
    database
      .select({ id: posts.id, score: rankScore.as('score') })
      .from(posts)
      .leftJoin(rankVoteScore, eq(rankVoteScore.postId, posts.id))
      .orderBy(desc(rankScore), desc(posts.createdAt), desc(posts.id))
      .limit(50),
  )

  const visibleIds = database.select({ id: feedIds.id }).from(feedIds)

  const commentCount = database
    .select({ postId: comments.postId, count: sql<number>`count(*)`.as('count') })
    .from(comments)
    .where(inArray(comments.postId, visibleIds))
    .groupBy(comments.postId)
    .as('comment_count')

  const cCount = sql<number>`coalesce(${commentCount.count}, 0)`
  const myVote = alias(votes, 'my_vote')
  const myVoterId = voterId ?? ''

  const rows = await database
    .with(feedIds)
    .select({
      post: posts,
      generation: generations,
      upload: uploads,
      found,
      score: sql<number>`coalesce(${feedIds.score}, 0)`,
      myVote: myVote.value,
      commentCount: cCount,
    })
    .from(feedIds)
    .innerJoin(posts, eq(posts.id, feedIds.id))
    .leftJoin(generations, eq(generations.postId, posts.id))
    .leftJoin(uploads, eq(uploads.postId, posts.id))
    .leftJoin(found, eq(found.postId, posts.id))
    .leftJoin(commentCount, eq(commentCount.postId, posts.id))
    .leftJoin(myVote, and(eq(myVote.postId, posts.id), eq(myVote.voterId, myVoterId)))
    .orderBy(desc(feedIds.score), desc(posts.createdAt), desc(posts.id))

  return rows.map((row, i): FeedItem => ({
    ...rowToRenderablePost(row),
    rank: i + 1,
  }))
}

// [LAW:single-enforcer] Single-post lookup — the permalink route (/p/:id)
// funnels through here. Returns RenderablePost (not FeedItem) because rank
// is feed-list-position semantics, meaningless when there's no list.
// [LAW:one-type-per-behavior] — the return type itself records that this
// is a single-post view, not a list-of-one. Returns null on miss (the wire
// decides the 404 status; the reader does not throw on absence, only on
// shape violations).
//
// The shared selectFeedRows helper guarantees the same aggregates the feed
// uses — score, commentCount, myVote — so a future change to any aggregate
// applies to both views by construction.
export async function getFeedItemById(
  env: Env,
  id: PostId,
  voterId?: string,
): Promise<RenderablePost | null> {
  const database = db(env)
  const { query } = selectFeedRows(database, [id], voterId)

  const rows = await query.limit(1)

  if (rows.length === 0) return null
  return rowToRenderablePost(rows[0])
}

// [LAW:single-enforcer] Single-post lookup — fork's parent-recipe fetch funnels
// through here. Returns null on miss (the wire decides the 404 status; the
// reader does not throw on absence, only on shape violations). Same toPost
// helpers as getFeed, so a generation post's recipe parses identically whether
// it arrives via the feed or via this lookup — the wire shape (Content, Status,
// RecipeSubject) is one boundary translation, not two.
//
// [LAW:dataflow-not-control-flow] Same query shape as getFeed minus the
// aggregates: posts + LEFT JOIN generations + LEFT JOIN uploads. No per-post
// score/commentCount/myVote because fork's loader does not render those — it
// renders the recipe form.
export async function getPostById(env: Env, id: PostId): Promise<Post | null> {
  const database = db(env)

  const rows = await database
    .select({
      post: posts,
      generation: generations,
      upload: uploads,
      found,
    })
    .from(posts)
    .leftJoin(generations, eq(generations.postId, posts.id))
    .leftJoin(uploads, eq(uploads.postId, posts.id))
    .leftJoin(found, eq(found.postId, posts.id))
    .where(eq(posts.id, id))
    .limit(1)

  if (rows.length === 0) return null
  return toPost(rows[0])
}
