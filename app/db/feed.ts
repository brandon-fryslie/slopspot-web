// [LAW:single-enforcer] The one place the homepage feed comes out of D1. The
// read-side inverse of createPost (app/db/posts.ts): createPost switches on the
// status it writes and sets that arm's columns; this reader switches on the status
// it reads and pulls that arm's columns. Same discriminators, opposite direction.
//
// [LAW:types-are-the-program] FeedItem is the smooth seam between storage and
// rendering (app/lib/domain.ts). This module's whole job is to absorb the
// impedance between the storage shape (D1 columns are independently nullable; the
// vote score is a separate aggregate) and the domain shape (Content/GenerationStatus
// are closed discriminated unions). Everything below is the residue of that one map.

import { desc, eq, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import {
  generations,
  posts,
  uploads,
  votes,
  type DbGeneration,
  type DbPost,
  type DbUpload,
} from '~/db/schema'
import {
  PostId,
  ProviderId,
  type Content,
  type FeedItem,
  type GenerationStatus,
  type Media,
  type Origin,
  type Post,
} from '~/lib/domain'

// One flat join row. The sibling tables are nullable because the DB does not
// enforce cross-table cardinality (that is createPost's transactional invariant);
// contentKind is the discriminator that says which sibling is the real one.
type FeedRow = {
  post: DbPost
  generation: DbGeneration | null
  upload: DbUpload | null
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

// JSON columns hold exactly what createPost serialized — our own shapes, not foreign
// input — so this is a typed deserialize, not a defensive re-parse.
function parseJson<T>(json: string): T {
  return JSON.parse(json)
}

// [LAW:types-are-the-program] Closed union → exhaustive switch, mirroring PostCard.
// Adding a GenerationStatus variant fails to compile here until handled; no default.
function toStatus(g: DbGeneration): GenerationStatus {
  switch (g.status) {
    case 'pending':
      return { kind: 'pending', queuedAt: required(g.queuedAt, 'pending.queuedAt') }
    case 'running':
      return { kind: 'running', startedAt: required(g.startedAt, 'running.startedAt') }
    case 'succeeded':
      return {
        kind: 'succeeded',
        output: parseJson<Media>(required(g.outputJson, 'succeeded.outputJson')),
        completedAt: required(g.completedAt, 'succeeded.completedAt'),
      }
    case 'failed':
      return {
        kind: 'failed',
        reason: required(g.failedReason, 'failed.failedReason'),
        failedAt: required(g.failedAt, 'failed.failedAt'),
      }
  }
}

function toContent(row: FeedRow): Content {
  if (row.post.contentKind === 'upload') {
    absent(row.generation, `generations row for upload post ${row.post.id}`)
    const u = required(row.upload, `uploads row for post ${row.post.id}`)
    return { kind: 'upload', asset: parseJson<Media>(u.assetJson) }
  }
  absent(row.upload, `uploads row for generation post ${row.post.id}`)
  const g = required(row.generation, `generations row for post ${row.post.id}`)
  return {
    kind: 'generation',
    recipe: {
      providerId: ProviderId(g.providerId),
      providerVersion: g.providerVersion,
      params: parseJson<unknown>(g.paramsJson),
      parentId: g.parentPostId ? PostId(g.parentPostId) : undefined,
    },
    status: toStatus(g),
  }
}

function toPost(row: FeedRow): Post {
  return {
    id: PostId(row.post.id),
    createdAt: row.post.createdAt,
    origin: parseJson<Origin>(row.post.originJson),
    content: toContent(row),
  }
}

export async function getFeed(env: Env): Promise<FeedItem[]> {
  const database = db(env)

  // [LAW:one-source-of-truth] Score is SUM(votes.value), never a stored column.
  // The subquery aggregates per post; the LEFT JOIN + COALESCE makes a post with no
  // votes score 0 rather than dropping out of the feed.
  const voteScore = database
    .select({
      postId: votes.postId,
      score: sql<number>`sum(${votes.value})`.as('score'),
    })
    .from(votes)
    .groupBy(votes.postId)
    .as('vote_score')

  const score = sql<number>`coalesce(${voteScore.score}, 0)`

  const rows = await database
    .select({
      post: posts,
      generation: generations,
      upload: uploads,
      score,
    })
    .from(posts)
    .leftJoin(generations, eq(generations.postId, posts.id))
    .leftJoin(uploads, eq(uploads.postId, posts.id))
    .leftJoin(voteScore, eq(voteScore.postId, posts.id))
    .orderBy(desc(score), desc(posts.createdAt))
    .limit(50)

  // rank is the post-sort position — derived per query, same as the seed produced.
  return rows.map((row, i) => ({ post: toPost(row), score: row.score, rank: i + 1 }))
}
