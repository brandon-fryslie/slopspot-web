// [LAW:types-are-the-program] D1 schema for slopspot. Each table is the
// physical residue of a type in app/lib/domain.ts. Where the domain encodes a
// discriminated union (Content.kind, GenerationStatus.kind), the schema either
// uses a discriminator column with sibling tables (posts.content_kind →
// generations | uploads) or encodes the union in CHECK constraints
// (generations.status). Either way, illegal states cannot be stored.
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
// stale data. style_family + style_subject_template are nullable now; the
// variety epic (slopspot-variety-pl6.2) backfills them.
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
    styleFamily: text('style_family'),
    styleSubjectTemplate: text('style_subject_template'),
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
