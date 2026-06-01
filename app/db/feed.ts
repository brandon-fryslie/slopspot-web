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

import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { db } from '~/db/client'
import {
  comments,
  found,
  generations,
  personas,
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
  type CitizenRef,
  type Content,
  type FeedItem,
  type GenerationStatus,
  type HumanModifier,
  type Media,
  type Origin,
  type PersonaActor,
  type Post,
  type RenderablePost,
  type VoteValue,
} from '~/lib/domain'
import { emit } from '~/observability/metrics'
import {
  aspectRatioSchema,
  fallbackTitle,
  recipeSubjectSchema,
  styleFamilySchema,
  type RecipeSubject,
} from '~/lib/variety'
import { applySortMode, defaultSortMode, windowFilter, type SortMode } from '~/lib/sort-mode'

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

// [LAW:no-silent-fallbacks] Map the stored title to the domain's non-empty title.
// An empty stored title is the ONLY value that triggers the deterministic placard,
// and when it does the fallback is LOUD — a metric + a console.warn carrying the
// post id — never a silent blank. The expected cause is a pre-migration row, but the
// warn deliberately states only the observable fact (empty title) and the id, so an
// unexpected new-write bug is just as visible and traceable. New rows store a real
// name, so this derivation degrades to identity by data.
function titleOrFallback(stored: string, subject: RecipeSubject, postId: string): string {
  // Trim before the emptiness test: a whitespace-only title is as blank as '' on the
  // card, so it must take the fallback too — the invariant is a *visible* name.
  if (stored.trim().length > 0) return stored
  emit('slopspot.feed.title_fallback', { reason: 'empty_title' }, 1)
  const derived = fallbackTitle(subject)
  console.warn('feed: generation row has an empty title; derived placard from subject', {
    postId,
    subjectTemplate: subject.subjectTemplate,
    derived,
  })
  return derived
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
        // [LAW:no-silent-fallbacks] An empty stored title triggers the deterministic
        // placard (the expected cause is a pre-migration row; any other empty write
        // surfaces here too). The domain never sees an empty title, and the unnamed
        // count is a LOUD metric + a post-id'd warn, not a silent blank placard.
        title: titleOrFallback(g.title, subject, g.postId),
        recipe: {
          providerId: ProviderId(g.providerId),
          providerVersion: g.providerVersion,
          params: parseJson<unknown>(g.paramsJson, `params_json for post ${g.postId}`),
          styleFamily,
          aspectRatio,
          subject,
          parentId: g.parentPostId === null ? undefined : PostId(g.parentPostId),
          // The wish is genuinely optional (only Well-born generations have one),
          // so a NULL column is a legal absence, not a violated invariant — map it
          // to undefined rather than failing loud. [LAW:no-defensive-null-guards]
          wish: g.wish ?? undefined,
        },
        status: toStatus(g),
      }
    }
    default:
      return assertNever(row.post.contentKind, `contentKind for post ${row.post.id}`)
  }
}

// [LAW:types-are-the-program] Storage→domain anti-corruption for origin_json. Two
// shapes coexist on disk by design: the current discriminated Origin
// ({ kind, author | finder | uploader }) and the pre-attribution legacy shape
// ({ actor }). Content.kind is the AUTHORITATIVE discriminator — the arm is chosen by
// it, never by a `kind` the JSON might disagree with, so the two can never drift apart
// at read. [LAW:one-source-of-truth]
//
// No Zod here (matching this module's parseJson cast — the shape is trusted at this
// boundary the way params_json is). The one invariant that MUST hold — a generation is
// AUTHORED by a persona — is checked and fails loud, exactly like the sibling-row and
// vote-value checks elsewhere in this reader. [LAW:no-silent-fallbacks]
function storedPrincipal(raw: unknown): Actor {
  const r = raw as { author?: Actor; finder?: Actor; uploader?: Actor; actor?: Actor }
  const a = r.author ?? r.finder ?? r.uploader ?? r.actor
  if (a === undefined) {
    throw new Error('origin_json carries no author/finder/uploader/actor')
  }
  return a
}

function storedHuman(raw: unknown): HumanModifier | undefined {
  return (raw as { human?: HumanModifier }).human
}

function toOrigin(contentKind: Content['kind'], raw: unknown, postId: string): Origin {
  const actor = storedPrincipal(raw)
  switch (contentKind) {
    case 'generation': {
      if (actor.kind !== 'agent') {
        // A generation is AUTHORED — its author is a persona, always. A non-agent here
        // is a storage-integrity violation (a human in the author slot); fail loud
        // rather than launder it into a shape the domain forbids.
        throw new Error(
          `origin_json for generation post ${postId} has a non-persona author (${actor.kind})`,
        )
      }
      const human = storedHuman(raw)
      return human !== undefined
        ? { kind: 'authored', author: actor, human }
        : { kind: 'authored', author: actor }
    }
    case 'found':
      return { kind: 'found', finder: actor }
    case 'upload':
      return { kind: 'uploaded', uploader: actor }
    default:
      return assertNever(contentKind, `contentKind for origin of post ${postId}`)
  }
}

// [LAW:one-source-of-truth] [RECONCILE A] A persona's public identity (handle +
// displayName) is authoritative in the personas table. Feed readers resolve the
// agent Actor's reference (agentId) into a CitizenRef here rather than storing a
// redundant copy in origin_json. One batch query per feed load regardless of how
// many posts have agent origins. handle and displayName come from the same row,
// so the resolution is atomic — never a half-populated CitizenRef.
async function fetchCitizenRefs(
  database: ReturnType<typeof db>,
  agentIds: readonly string[],
): Promise<Map<string, CitizenRef>> {
  if (agentIds.length === 0) return new Map()
  const rows = await database
    .select({
      agentId: personas.agentId,
      handle: personas.handle,
      displayName: personas.displayName,
    })
    .from(personas)
    .where(inArray(personas.agentId, agentIds))
  // [LAW:types-are-the-program] A CitizenRef carries the citizen's NAME always and
  // its handle (null until minted). Every resolved persona row produces one — the
  // name is what attribution shows, the handle is what lights the /cast link.
  // [LAW:one-source-of-truth] The agentId-label fallback is for a genuinely
  // persona-less actor (no row here), never for an un-minted-but-named citizen.
  const refs = new Map<string, CitizenRef>()
  for (const r of rows) {
    refs.set(r.agentId, { handle: r.handle, displayName: r.displayName })
  }
  return refs
}

// [LAW:one-source-of-truth] Resolve an agent's persona reference (agentId) into its
// CitizenRef. Construct explicitly rather than spreading parsed JSON so the
// storage→domain boundary emits exactly the domain shape. A persona-less agent (no
// row) keeps just its agentId — the renderer's documented fallback. The narrowed
// return preserves PersonaActor for the author slot, which is agent-only by type.
function enrichPersona(a: PersonaActor, refs: Map<string, CitizenRef>): PersonaActor {
  const persona = refs.get(a.agentId)
  return persona !== undefined
    ? { kind: 'agent', agentId: a.agentId, persona }
    : { kind: 'agent', agentId: a.agentId }
}

function enrichActor(actor: Actor, refs: Map<string, CitizenRef>): Actor {
  return actor.kind === 'agent' ? enrichPersona(actor, refs) : actor
}

// [LAW:one-type-per-behavior] One enricher per origin arm: the author (a persona,
// always), the finder (any actor — a persona-finder gets the same face the author
// does), the uploader. The human modifier's `by` is a HumanRef (never a persona), so
// it carries no agentId to resolve.
function enrichOrigin(origin: Origin, refs: Map<string, CitizenRef>): Origin {
  switch (origin.kind) {
    case 'authored':
      return origin.human !== undefined
        ? { kind: 'authored', author: enrichPersona(origin.author, refs), human: origin.human }
        : { kind: 'authored', author: enrichPersona(origin.author, refs) }
    case 'found':
      return { kind: 'found', finder: enrichActor(origin.finder, refs) }
    case 'uploaded':
      return { kind: 'uploaded', uploader: enrichActor(origin.uploader, refs) }
  }
}

function enrichPost(post: Post, refs: Map<string, CitizenRef>): Post {
  return { ...post, origin: enrichOrigin(post.origin, refs) }
}

// [LAW:single-enforcer] One pass collecting every agentId that needs a CitizenRef: the
// author of an authored slop, and a persona finder/uploader. Human modifiers reference
// no persona, so they contribute nothing.
function collectAgentIds(posts: readonly Post[]): string[] {
  const ids = new Set<string>()
  for (const p of posts) {
    const o = p.origin
    if (o.kind === 'authored') ids.add(o.author.agentId)
    else if (o.kind === 'found' && o.finder.kind === 'agent') ids.add(o.finder.agentId)
    else if (o.kind === 'uploaded' && o.uploader.kind === 'agent') ids.add(o.uploader.agentId)
  }
  return [...ids]
}

function toPost(row: FeedRow): Post {
  return {
    id: PostId(row.post.id),
    createdAt: row.post.createdAt,
    origin: toOrigin(
      row.post.contentKind,
      parseJson<unknown>(row.post.originJson, `origin_json for post ${row.post.id}`),
      row.post.id,
    ),
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

// [LAW:one-source-of-truth] A CTE computes the ranked visible post set and
// their scores in one place. Vote score lives inside the CTE (COALESCE of
// the vote-sum over all votes for each post). The comments aggregate subquery
// references the CTE via `SELECT id FROM feed_ids` — a SQL subquery, not a
// bind-param list. The previous two-phase design (pickFeedIds → selectFeedRows)
// re-passed the same 50 ids as bind params three times (votes IN, comments IN,
// WHERE IN = 151 params), exceeding D1's 100-variable limit past ~32 posts.
//
// `desc(posts.id)` is the deterministic tie-breaker for equal score+createdAt.
//
// [LAW:single-enforcer] sort defaults to defaultSortMode (top/all) — today's
// behavior. Both the CTE inner query (rank candidates) and the outer hydration
// query spread applySortMode's result; keeping them in sync is enforced by
// calling the same function in both places.
export async function getFeed(
  env: Env,
  voterId?: string,
  sort: SortMode = defaultSortMode,
): Promise<FeedItem[]> {
  const database = db(env)

  const { voteScore: rankVoteScore, score: rankScore } = voteScoreSubquery(database, undefined)

  // [LAW:dataflow-not-control-flow] applySortMode returns the ORDER BY expressions;
  // windowFilter returns the WHERE predicate (or undefined = no filter); both are
  // called unconditionally — the SortMode value picks the expressions and predicate.
  const feedIds = database.$with('feed_ids').as(
    database
      .select({ id: posts.id, score: rankScore.as('score') })
      .from(posts)
      .leftJoin(rankVoteScore, eq(rankVoteScore.postId, posts.id))
      .where(windowFilter(sort, posts.createdAt, Date.now()))
      .orderBy(...applySortMode(sort, { score: rankScore, createdAt: posts.createdAt, id: posts.id }))
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
    .orderBy(...applySortMode(sort, { score: feedIds.score, createdAt: posts.createdAt, id: posts.id }))

  const renderables = rows.map((row) => rowToRenderablePost(row))
  const agentIds = collectAgentIds(renderables.map((r) => r.post))
  const refs = await fetchCitizenRefs(database, agentIds)

  return renderables.map((r, i): FeedItem => ({
    post: enrichPost(r.post, refs),
    score: r.score,
    myVote: r.myVote,
    commentCount: r.commentCount,
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

  const renderable = rowToRenderablePost(rows[0])
  const agentIds = collectAgentIds([renderable.post])
  const refs = await fetchCitizenRefs(database, agentIds)
  return { ...renderable, post: enrichPost(renderable.post, refs) }
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
