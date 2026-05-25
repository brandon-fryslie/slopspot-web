// [LAW:types-are-the-program] D1 schema for slopspot. Each table is the
// physical residue of a type in app/lib/domain.ts. Discriminated unions map two
// ways: a discriminator column with sibling tables (posts.content_kind →
// generations | uploads), or CHECK constraints encoding the union arms
// (generations.status, posts.content_kind, votes.value).
//
// What the DB enforces: per-row shape. No row can hold an out-of-range
// discriminator or a status/field combination outside one GenerationStatus arm.
// What the DB does NOT enforce: cross-table cardinality — that a 'generation'
// post has exactly one matching generations row (and no uploads row), or vice
// versa. That invariant is transactional (the parent row is written before its
// sibling), so it lives in the single createPost writer (persistence.4), not in
// constraints. [LAW:single-enforcer] places it at that one boundary rather than
// scattering triggers across every sibling insert/delete.
//
// [LAW:one-source-of-truth] No score column on posts — score is SUM(votes.value)
// per post, computed at read time. Adding a denormalized score would create a
// second representation that can drift from the votes table.

import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

// Users placeholder. Auth is a later epic; this table exists so future FKs have
// somewhere to land. Origin.actor.userId references this id by convention.
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  displayName: text('display_name').notNull(),
})

// Posts root. content_kind is the discriminator that tells joins which sibling
// table holds the body. Origin is a small stable union we only ever render
// whole, so JSON-on-row is the right shape (no sub-field queries planned).
export const posts = sqliteTable(
  'posts',
  {
    id: text('id').primaryKey(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    contentKind: text('content_kind', {
      enum: ['generation', 'upload'],
    }).notNull(),
    originJson: text('origin_json').notNull(),
  },
  (t) => [
    index('posts_created_at_idx').on(t.createdAt),
    // [LAW:types-are-the-program] Drizzle's `enum` on a text column is
    // type-level only — it emits no SQL CHECK. Without this, the DB would
    // accept any string for content_kind, so a raw-SQL writer could store a
    // value the sibling-table join can't dispatch on. The CHECK makes the
    // discriminator real at the storage boundary, matching generations.status.
    check(
      'posts_content_kind_shape',
      sql`${t.contentKind} IN ('generation', 'upload')`,
    ),
  ],
)

// Generations: the recipe + async status for content_kind='generation' posts.
//
// status discriminator mirrors the GenerationStatus union in domain.ts:
//   pending   { queuedAt }
//   running   { startedAt }
//   succeeded { completedAt, output }
//   failed    { failedAt, reason }
//
// The CHECK constraint requires the companion fields of the current status to
// be present and forbids fields from other arms — so transitions must clear
// stale data.
//
// style_family / subject_template / slots_json / aspect_ratio are the variety
// taxonomy fields from design-docs/variety.md, all NOT NULL. They're orthogonal
// to the status discriminator (every status arm carries them), so they're not
// part of the status CHECK — each row has them by construction, written once
// at insert time. Slot keys live in slots_json as a JSON object whose shape
// is enforced by recipeSubjectSchema at the application read boundary.
export const generations = sqliteTable(
  'generations',
  {
    postId: text('post_id')
      .primaryKey()
      .references(() => posts.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    providerVersion: text('provider_version').notNull(),
    paramsJson: text('params_json').notNull(),
    parentPostId: text('parent_post_id').references(() => posts.id),
    // [LAW:one-source-of-truth] The DB-level DEFAULTs duplicate values that
    // 0001_variety_taxonomy.sql sets so `ALTER TABLE ADD COLUMN NOT NULL` can
    // populate existing rows. createPost always supplies these fields
    // explicitly — the DEFAULTs never fire in normal writes, they exist only
    // for migration scaffolding. Declaring them here keeps the schema source
    // of truth aligned with the migration so drizzle-kit's next `generate`
    // doesn't try to drop them.
    styleFamily: text('style_family').notNull().default('photoreal'),
    subjectTemplate: text('subject_template').notNull().default('T00'),
    slotsJson: text('slots_json').notNull().default('{"freeText":""}'),
    aspectRatio: text('aspect_ratio').notNull().default('1:1'),
    status: text('status', {
      enum: ['pending', 'running', 'succeeded', 'failed'],
    }).notNull(),
    queuedAt: integer('queued_at', { mode: 'timestamp_ms' }),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    outputJson: text('output_json'),
    failedAt: integer('failed_at', { mode: 'timestamp_ms' }),
    failedReason: text('failed_reason'),
  },
  (t) => [
    index('generations_status_idx').on(t.status),
    index('generations_parent_idx').on(t.parentPostId),
    check(
      'generations_status_shape',
      sql`(
        (${t.status} = 'pending'
          AND ${t.queuedAt} IS NOT NULL
          AND ${t.startedAt} IS NULL
          AND ${t.completedAt} IS NULL
          AND ${t.outputJson} IS NULL
          AND ${t.failedAt} IS NULL
          AND ${t.failedReason} IS NULL)
        OR (${t.status} = 'running'
          AND ${t.queuedAt} IS NULL
          AND ${t.startedAt} IS NOT NULL
          AND ${t.completedAt} IS NULL
          AND ${t.outputJson} IS NULL
          AND ${t.failedAt} IS NULL
          AND ${t.failedReason} IS NULL)
        OR (${t.status} = 'succeeded'
          AND ${t.queuedAt} IS NULL
          AND ${t.startedAt} IS NULL
          AND ${t.completedAt} IS NOT NULL
          AND ${t.outputJson} IS NOT NULL
          AND ${t.failedAt} IS NULL
          AND ${t.failedReason} IS NULL)
        OR (${t.status} = 'failed'
          AND ${t.queuedAt} IS NULL
          AND ${t.startedAt} IS NULL
          AND ${t.completedAt} IS NULL
          AND ${t.outputJson} IS NULL
          AND ${t.failedAt} IS NOT NULL
          AND ${t.failedReason} IS NOT NULL)
      )`,
    ),
  ],
)

// Uploads: sibling table for content_kind='upload' posts. Separate from posts
// (rather than JSON-on-row) because the discriminator-driven query is cleaner
// — joining uploads u ON p.id = u.post_id is one shape; pulling and parsing a
// JSON blob is another shape that doesn't unify with generations.
export const uploads = sqliteTable('uploads', {
  postId: text('post_id')
    .primaryKey()
    .references(() => posts.id, { onDelete: 'cascade' }),
  assetJson: text('asset_json').notNull(),
})

// Votes: source of truth for score. The (post_id, voter_id) PK enforces one
// vote per voter per post. value is -1 or 1 (Reddit-style; abstentions are
// just row absence).
//
// voter_id is opaque TEXT with no FK. The domain has both UserId and AgentId
// as branded strings; agents are expected to vote in later epics. A FK to
// users would forbid that. Application code is responsible for namespace
// disambiguation if user/agent ids ever collide.
export const votes = sqliteTable(
  'votes',
  {
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    voterId: text('voter_id').notNull(),
    value: integer('value').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.voterId] }),
    check('votes_value_shape', sql`${t.value} IN (-1, 1)`),
  ],
)

// Comments: flat thread per post. v1 is anonymous-only; author_id is the same
// opaque voter cookie UUID the votes table uses. No FK to users (mirroring
// votes) so a future auth surface can move user/agent ids into the same column
// without a schema rewrite.
//
// Index on (post_id, created_at DESC) for thread fetch — the dominant read
// pattern is "comments for this post, newest first." A WHERE post_id = ? scan
// without the (post_id, created_at) index would force a sort on every read.
//
// No CHECK on body length. Length policy is enforced by Zod at the HTTP trust
// boundary (1..2000); the DB constraint would lock that policy in two places
// and force a migration when v2 changes the cap. [LAW:single-enforcer] puts
// the rule at the boundary, not duplicated downward.
export const comments = sqliteTable(
  'comments',
  {
    id: text('id').primaryKey(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('comments_post_created_idx').on(t.postId, t.createdAt),
  ],
)

export type DbUser = typeof users.$inferSelect
export type NewDbUser = typeof users.$inferInsert
export type DbPost = typeof posts.$inferSelect
export type NewDbPost = typeof posts.$inferInsert
export type DbGeneration = typeof generations.$inferSelect
export type NewDbGeneration = typeof generations.$inferInsert
export type DbUpload = typeof uploads.$inferSelect
export type NewDbUpload = typeof uploads.$inferInsert
export type DbVote = typeof votes.$inferSelect
export type NewDbVote = typeof votes.$inferInsert
export type DbComment = typeof comments.$inferSelect
export type NewDbComment = typeof comments.$inferInsert
