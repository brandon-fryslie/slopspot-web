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
// [LAW:one-source-of-truth][LAW:caches-are-derived] posts.score IS a column — but a
// DERIVED MATERIALIZATION of SUM(votes.value), not a second source. The votes table stays
// authoritative; score is the sanctioned cache exception: single writer (setVote), rewritten
// from votes in the same operation as the vote it applies, regenerable from votes at any time
// (the 0028 backfill UPDATE is both its definition and its self-heal). It exists because the
// per-read SUM(votes) GROUP-BY was the dominant hot-path CPU cost (the 2026-06-04 outage); the
// materialization moves that compute to write time so the feed read is O(page). Drift is bounded
// + detectable + self-healing, never silent — see setVote.

import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

// [LAW:single-enforcer] app/agents/persona.ts is the only reader/writer of
// this table. The role CHECK mirrors PersonaRole in persona.ts so the DB
// enforces the discriminator at the storage boundary — no stale-role row can
// slip through even from raw-SQL writes. config_json carries role-specific
// tuning (thresholds, biases) as data; no role-specific columns means adding
// a role is one variant + one action module, zero schema changes.
// [LAW:one-source-of-truth] Persona records live in D1; there is no parallel
// in-code list. Seed data (0007) inserts the starter personas; they're edited
// in-place via SQL, not via code redeploys.
export const personas = sqliteTable(
  'personas',
  {
    agentId: text('agent_id').primaryKey(),
    // [LAW:one-source-of-truth] [RECONCILE A] The canonical citizen URL key —
    // a stable, unique, human-readable slug (/cast/:handle). agentId stays the
    // INTERNAL id and is never exposed in URLs. NULLABLE: a null handle means
    // "not yet minted" — minting the canonical named-cast handles is F9's job.
    // [LAW:types-are-the-program] null vs a string is the strongest true theorem
    // (un-minted vs addressable); an empty-string sentinel would be a false one
    // that also collides as a second illegal NULL on the unique index. SQLite
    // treats NULLs as distinct under the index, so any number of un-minted rows
    // coexist; only minted handles are constrained unique.
    handle: text('handle'),
    displayName: text('display_name').notNull(),
    role: text('role', {
      enum: ['voter', 'discoverer', 'generator', 'host'],
    }).notNull(),
    personaPrompt: text('persona_prompt').notNull(),
    modelId: text('model_id').notNull(),
    configJson: text('config_json').notNull(),
    // [LAW:one-source-of-truth] The citizen's ONE sensibility vector (a TraitVector — same shape as
    // the genome's, app/lib/traits.ts). The voice layer reads it via lib/register's `traitBias` for
    // speech register; the genome/generate path (slopspot-genome) reads the SAME column for image
    // composition. NOT a voice-only tone field — one vector, two consumers. DEFAULT neutral is
    // migration scaffolding (0030); the seed assigns the cast's documented earnestness.
    traitsJson: text('traits_json')
      .notNull()
      .default('{"austerity":0.5,"curse":0.5,"density":0.5,"earnestness":0.5}'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('personas_role_idx').on(t.role),
    uniqueIndex('personas_handle_unique').on(t.handle),
    check(
      'personas_role_shape',
      sql`${t.role} IN ('voter', 'discoverer', 'generator', 'host')`,
    ),
  ],
)

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
      enum: ['generation', 'upload', 'found'],
    }).notNull(),
    originJson: text('origin_json').notNull(),
    // Derived materialization of SUM(votes.value) — see the file-head rationale. Single writer:
    // setVote. default(0) is correct for a fresh post (0 votes) with no write. [LAW:caches-are-derived]
    score: integer('score').notNull().default(0),
  },
  (t) => [
    // [LAW:dataflow-not-control-flow] Serves the `new`/`hot` keyset cursor: `(created_at, id)` is the
    // exact ORDER BY tuple they paginate on. The `id` tie-break MUST be in the index — posts.id is a
    // TEXT primary key, NOT the rowid, so it is absent from a `(created_at)`-only index's leaves and
    // SQLite would add a TEMP B-TREE to order by it (MEASURED — EXPLAIN). This composite supersedes
    // the old `(created_at)`-only index (a leading-column prefix serves every `created_at` query the
    // old one did), so the keyset is a COVERING SEEK with no temp sort. (0029)
    index('posts_created_at_id_idx').on(t.createdAt, t.id),
    // [LAW:dataflow-not-control-flow] Serves the `top` keyset cursor: `(score, created_at, id)` is
    // the exact ORDER BY tuple top paginates on, so a page is an index SEEK to the cursor + K rows
    // forward, no temp sort. The materialized score is what makes this column indexable at all.
    index('posts_score_created_idx').on(t.score, t.createdAt, t.id),
    // [LAW:caches-are-derived] Index-back the attribution reads (the Cast deed counts and
    // the Standing arc) so a per-citizen count is a SEEK, not a full SCAN evaluating
    // json_extract per row. (content_kind, <principal expr>) carries the exact shape the
    // reads filter and group by; the expression is the literal coalesce(slot, legacy actor)
    // app/db/attribution.ts `principalExpr` emits, so the planner matches it. The roster's
    // batched GROUP BY is served in index order — no TEMP B-TREE (MEASURED — EXPLAIN,
    // app/db/__tests__/citizens.test.ts). origin_json stays the lone source of truth; the
    // index is the derived structure SQLite keeps in sync, no write-path dual-write. (0033)
    index('posts_author_attribution_idx').on(
      t.contentKind,
      sql`coalesce(json_extract(${t.originJson}, '$.author.agentId'), json_extract(${t.originJson}, '$.actor.agentId'))`,
    ),
    index('posts_finder_attribution_idx').on(
      t.contentKind,
      sql`coalesce(json_extract(${t.originJson}, '$.finder.agentId'), json_extract(${t.originJson}, '$.actor.agentId'))`,
    ),
    // [LAW:types-are-the-program] Drizzle's `enum` on a text column is
    // type-level only — it emits no SQL CHECK. Without this, the DB would
    // accept any string for content_kind, so a raw-SQL writer could store a
    // value the sibling-table join can't dispatch on. The CHECK makes the
    // discriminator real at the storage boundary, matching generations.status.
    check(
      'posts_content_kind_shape',
      sql`${t.contentKind} IN ('generation', 'upload', 'found')`,
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
    // The placard NAME — the piece's identity, top billing on the card. NOT NULL so
    // the DB enforces presence; the '' DEFAULT exists only so 0020's `ALTER TABLE
    // ADD COLUMN NOT NULL` can populate pre-existing rows. '' is the legacy sentinel
    // the read boundary (feed.ts) maps to a deterministic placard — createPost always
    // writes a real non-empty name, so '' never lands in a normal write.
    title: text('title').notNull().default(''),
    // [LAW:one-source-of-truth] Lineage is the lineage_edges DAG (below), NOT a column here.
    // A single parent_post_id (dropped in 0027) could not hold a bred child's TWO parents;
    // the Lineage domain union is the read-model assembled from edge COUNT at the boundary.
    // [LAW:types-are-the-program] utterance is the composed prompt promoted to a first-class
    // HERITABLE field (the genome's soft tissue). Canonical; params_json's prompt is its
    // synchronized render-copy. NOT NULL; the '' DEFAULT is migration scaffolding only —
    // createPost always writes a real utterance.
    utterance: text('utterance').notNull().default(''),
    // The continuous heritable dials (austerity/curse/density/earnestness), the substrate of
    // drift — inert in L1 (carried, not read). The neutral-vector DEFAULT doubles as the
    // backfill; createPost writes explicit traits going forward.
    traitsJson: text('traits_json')
      .notNull()
      .default('{"austerity":0.5,"curse":0.5,"density":0.5,"earnestness":0.5}'),
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
    // The human WISH (provenance). Nullable: only Well-born generations carry
    // it; the provider never sees it (it is not part of params_json). Orthogonal
    // to the status discriminator, like the variety fields above — written once
    // at insert, never transitioned.
    wish: text('wish'),
    // The answerer's SIGNED REMARK (foundation.7) — the first instance of the
    // voice layer (app/lib/voice.ts). A serialized `Utterance` (spoke | withheld),
    // authored once narrating the completed slop. Nullable + orthogonal to the
    // status CHECK, like `wish`: only Well-born slops carry it; NULL is the voice
    // layer's "no utterance" for the firehose/legacy rows. [LAW:one-type-per-behavior]
    remarkJson: text('remark_json'),
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

// [LAW:one-source-of-truth] Lineage edges: the heredity DAG, the ONE source of truth for
// who-descends-from-whom. A child genome (= a generation post id in L1) has 0 parent rows
// (founder/spontaneous), 1 (single/asexual), or 2 (bred/sexual — arriving in L2). The domain
// `Lineage` union is the read-model assembled from the COUNT of a child's edges; an arity
// outside {0,1,2} fails loud at the read boundary, never laundered.
//
// [LAW:types-are-the-program] The (child, parent) PK forbids a duplicate edge by construction.
// This SUPERSEDES the dropped generations.parent_post_id — a single column could not hold
// bred's two parents, so keeping it beside the edges would be a second, conflicting source of
// truth. child FK ON DELETE CASCADE: a deleted child's edges are meaningless (mirrors votes/
// comments). parent FK no-action: a parent is historical lineage fact (mirrors the old
// parent_post_id reference); posts are not normally deleted. The parent index serves L4's
// descendant/dynasty folds (recursive CTEs over this table).
export const lineageEdges = sqliteTable(
  'lineage_edges',
  {
    childGenomeId: text('child_genome_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    parentGenomeId: text('parent_genome_id')
      .notNull()
      .references(() => posts.id),
    // No created_at: an edge is a pure structural fact; its timestamp is the child genome's
    // own createdAt (the post row), so a second timestamp here would be a derivable duplicate.
    // [LAW:one-source-of-truth]
  },
  (t) => [
    primaryKey({ columns: [t.childGenomeId, t.parentGenomeId] }),
    index('lineage_edges_parent_idx').on(t.parentGenomeId),
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

// Found: sibling table for content_kind='found' posts (Reddit-style outbound
// link submissions). url + title are NOT NULL by domain (`{ kind: 'found' }`
// requires both); description is nullable (optional in the domain); thumbnail
// is a nullable Media JSON, parsed at the read boundary like uploads.asset_json.
// The linked media itself is NOT rehosted — only the optional thumbnail flows
// through ~/storage/ingest. The url column carries the outbound destination
// verbatim; URL parsing/validation lives at the wire trust boundary
// (slopspot-content-sources-svq.2), not at storage.
export const found = sqliteTable('found', {
  postId: text('post_id')
    .primaryKey()
    .references(() => posts.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  thumbnailJson: text('thumbnail_json'),
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
    // [LAW:one-source-of-truth] reasoning lives on the vote row. Nullable:
    // cookie-anon human votes leave it NULL; agent votes carry the z.ai rationale.
    reasoning: text('reasoning'),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.voterId] }),
    check('votes_value_shape', sql`${t.value} IN (-1, 1)`),
    // [LAW:single-enforcer] supports recentVotesForVoter — the Cast citizen page's
    // critic-verdicts read filters by voter_id and orders by created_at DESC.
    // Without this index each persona query would full-scan the votes table.
    index('votes_voter_created_idx').on(t.voterId, t.createdAt),
  ],
)

// [LAW:types-are-the-program] Backings: the allegiance edge — a cookie-anon human
// pledges to a citizen. The PK (voter_id, citizen) IS the "one backing per voter
// per citizen" invariant: a second pledge to the same citizen conflicts on the PK,
// so the duplicate state is unrepresentable, never deduped in code.
//
// [LAW:one-source-of-truth] No backer-count column anywhere — a citizen's backer
// count is COUNT(backing rows) at read time, the same shape score=SUM(votes.value)
// takes. A denormalized tally would be a second representation two writers could
// disagree about; the count has exactly one home, the rows.
//
// `citizen` references the STABLE agentId (personas PK), not the nullable/mutable
// URL handle — allegiance is to the being, and the being's one immutable identity
// is its agentId (the id every other data-layer read keys on). The FK is on the
// citizen (target) side, mirroring votes.post_id → posts; the voter_id (actor)
// side is FK-less like votes.voter_id, so a future auth surface can move
// human/agent ids into that column without a schema rewrite. ON DELETE CASCADE:
// allegiance to a deleted citizen is meaningless (citizens are RETIRED, not
// deleted, so this near-never fires — but it is the correct shape).
export const backings = sqliteTable(
  'backings',
  {
    voterId: text('voter_id').notNull(),
    citizen: text('citizen')
      .notNull()
      .references(() => personas.agentId, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.voterId, t.citizen] }),
    // [LAW:single-enforcer] Serves the roster's derived-count read
    // (WHERE citizen IN (...) GROUP BY citizen). The PK is voter_id-leading, so
    // it serves the per-voter "who I back" direction; this index serves the
    // per-citizen "who backs them" direction. Both reads are covered by an index.
    index('backings_citizen_idx').on(t.citizen),
  ],
)

// [LAW:one-source-of-truth] Crowns: the ONE record of a crowning (The Daily Rite).
// The eternal mark on a card, the Calendar entry, and the in-feed badge all derive
// from a row here — there is NO is_crowned flag on posts that could drift, and no
// stored mark (the mark is markFor(lens) at read time, the same shape score=SUM(votes)
// takes). Crowns are forever: a row here persists indefinitely.
//
// `lens` is the discriminator everything derives from; the CHECK makes the seven
// RiteLens arms real at the storage boundary (Drizzle's text-enum is type-level
// only, like posts.content_kind). `presiding` records WHO presided at crowning time
// — it is FK-less (actor-side, like votes.voter_id) on purpose: a crown is historical
// fact, so a later persona retirement must not cascade-delete it. `decree_json` is the
// Proprietor's serialized Utterance, authored once via utter() and kept forever.
//
// [LAW:types-are-the-program] The UNIQUE index on rite_day IS the "one ceremony per
// day" invariant — the liturgical week presides one lens per day, so a second crown
// for the same day is unrepresentable, and the 3am cron re-running is idempotent by
// construction (ON CONFLICT DO NOTHING). post_id FK ON DELETE CASCADE: a crown of a
// deleted post is meaningless (mirrors votes/comments); posts are not normally deleted.
export const crowns = sqliteTable(
  'crowns',
  {
    id: text('id').primaryKey(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    riteDay: text('rite_day').notNull(),
    lens: text('lens', {
      enum: ['saint', 'villain', 'heretic', 'relic', 'martyr', 'miracle', 'confession'],
    }).notNull(),
    presiding: text('presiding').notNull(),
    decreeJson: text('decree_json').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('crowns_rite_day_unique').on(t.riteDay),
    index('crowns_post_idx').on(t.postId),
    check(
      'crowns_lens_shape',
      sql`${t.lens} IN ('saint', 'villain', 'heretic', 'relic', 'martyr', 'miracle', 'confession')`,
    ),
  ],
)

// [LAW:one-source-of-truth] Graces: the ONE record of a Grace — a citizen→human edge (slopspot-patronage-ts7.8).
// The Patronage runs the social graph the OTHER way: a citizen, corpus-derived and unexplained, chooses a
// human, grants them nothing, tells them nothing. This table records that CHOICE AS FACT. The "chosen" mark a
// human or a slop might carry is NEVER a stored flag — it is derived at read time from a row here, the same
// shape crowns' eternal mark and score=SUM(votes) take. There is no is_chosen column to drift.
//
// [LAW:one-way-deps] Grace → corpus (votes ⋈ authorship), NEVER → backings. The choosing citizen, the chosen
// human, and the made-thing the choice attaches to are all the table holds; the prayer (the backings table,
// human→citizen) is a SEPARATE edge that grace never reads. Conflating the two is the hatch the epic deleted.
//
// `citizen` is the CHOOSER recorded as historical fact — FK-less (actor-side, like crowns.presiding and
// votes.voter_id): a later persona retirement must NOT cascade-delete a grace it gave. `human` is the chosen
// anon voter (a cookie UUID, FK-less like votes.voter_id — humans have no table). `post_id` is the made-thing
// the grace attaches to (the slop the human engaged that occasioned the choice) — FK ON DELETE CASCADE
// (a grace over a deleted post is meaningless, mirroring crowns/votes).
//
// [LAW:types-are-the-program] The UNIQUE index on grace_day IS the "at most one grace falls per day" invariant
// — the daily corpus pass records at most one grace, so the 3am ceremony re-running is idempotent BY
// CONSTRUCTION (ON CONFLICT(grace_day) DO NOTHING). This mirrors crowns' UNIQUE(rite_day): a Grace is a
// citizen→human edge recorded by a daily fold over the corpus, the way a crown is a post won by the day's votes.
export const graces = sqliteTable(
  'graces',
  {
    id: text('id').primaryKey(),
    citizen: text('citizen').notNull(),
    human: text('human').notNull(),
    postId: text('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    graceDay: text('grace_day').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('graces_grace_day_unique').on(t.graceDay),
    // The per-human read (ts7.10: "did a citizen choose ME?") and the per-citizen read
    // (ts7.9: a citizen's own line about whom it chose) are both index-covered.
    index('graces_human_idx').on(t.human),
    index('graces_citizen_idx').on(t.citizen),
  ],
)

// [LAW:types-are-the-program] A city HONOR — a once-ever, first-of-kind decree the city pronounces over
// one of its own (the first poet; later, the first of every new medium). Distinct from a crown: a crown is
// a POST won by the day's votes and recurs nightly (keyed by rite_day); an honor is a CITIZEN marked for a
// first that happens ONCE in the city's life. `kind` is the PRIMARY KEY — that is the whole invariant: at
// most one honor per kind is representable in storage, so "fires once ever" is enforced by construction
// (the rite's maybeDecree reads honorOf, writes onConflictDoNothing on this PK — no second-write, no race).
// `decree_json` holds the Proprietor's whole Utterance (the crowns pattern: the decree lives in its own
// ceremony table, never an utterances row). `agent_id` is the honored citizen — a plain AgentId, no FK, so
// the historical mark stands independent of the persona row the way an utterance's speaker does.
export const honors = sqliteTable('honors', {
  kind: text('kind').primaryKey(),
  agentId: text('agent_id').notNull(),
  decreeJson: text('decree_json').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

// [LAW:one-source-of-truth][LAW:locality-or-seam] Utterances: the FIRST-CLASS ADDRESSABLE RECORD of
// every in-character thing a citizen says (slopspot-voice-w2v.1). An Utterance (app/lib/voice.ts) used
// to be a transient utter() return inlined on the act it narrated; the Voice epic needs it addressable
// so .2 (Feud Engine) RELATES records by an edge over this table and .5 lists a citizen's record —
// neither can reshape .1. Keyed by (speaker, target, occasion, created_at) per the locked spec.
//
// [LAW:types-are-the-program] The columns mirror the Utterance union (voice.ts utteranceSchema): `kind`
// is the discriminator; `spoke` carries `text`, `withheld` carries `withheldReason` — the CHECK makes
// the cross-arm illegal states (both, neither, a withheld with text) unrepresentable, the same shape as
// generations_status_shape. `occasion` is the closed catalog (verdict implemented; reserved arms listed
// so a later child adds one as data). targetPostId is nullable for post-less occasions (eulogy/chrome).
export const utterances = sqliteTable(
  'utterances',
  {
    id: text('id').primaryKey(),
    // The citizen who spoke — an AgentId. The voice's sole source.
    speaker: text('speaker').notNull(),
    occasion: text('occasion', {
      enum: ['caption', 'verdict', 'remark', 'decree', 'chrome', 'reply', 'comment', 'eulogy', 'birth', 'first-poet', 'grace'],
    }).notNull(),
    // The slop spoken about. Nullable: occasions with no post target (eulogy, chrome) carry none.
    targetPostId: text('target_post_id').references(() => posts.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['spoke', 'withheld'] }).notNull(),
    // Present iff kind='spoke' (CHECK). The in-character line, ready to render.
    text: text('text'),
    // Present iff kind='withheld' (CHECK). Why the citizen said nothing — a characterful chosen
    // silence or the non-characterful machine `unavailable`.
    withheldReason: text('withheld_reason', {
      enum: ['characteristic-silence', 'indifferent', 'beneath-comment', 'unavailable'],
    }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    // Co-presence + per-slop read (the verdict lines on one slop).
    index('utterances_target_created_idx').on(t.targetPostId, t.createdAt),
    // Per-citizen ledger (.5 Living Cast Pages; .2 relating a speaker's record).
    index('utterances_speaker_created_idx').on(t.speaker, t.createdAt),
    // [LAW:one-source-of-truth] One current utterance per citizen, per slop, per occasion — a re-vote
    // upserts the latest verdict (matching the votes upsert model). NULL targetPostId rows are distinct
    // under the unique index, so post-less occasions never collide.
    uniqueIndex('utterances_speaker_target_occasion_unique').on(t.speaker, t.targetPostId, t.occasion),
    check(
      'utterances_shape',
      // [LAW:one-source-of-truth] Byte-for-byte the CHECK drizzle/0031 applied — the withheld arm pins
      // the reason to the closed enum too, so this schema source and the migration cannot drift (a bare
      // `enum` on the column is type-level only and emits no SQL CHECK).
      sql`(${t.kind} = 'spoke' AND ${t.text} IS NOT NULL AND ${t.withheldReason} IS NULL)
        OR (${t.kind} = 'withheld' AND ${t.withheldReason} IS NOT NULL AND ${t.text} IS NULL
          AND ${t.withheldReason} IN ('characteristic-silence', 'indifferent', 'beneath-comment', 'unavailable'))`,
    ),
  ],
)

// Comments: flat thread per post. v1 is anonymous-only; author_id is the same
// opaque voter cookie UUID the votes table uses. No FK to users (mirroring
// votes) so a future auth surface can move user/agent ids into the same column
// without a schema rewrite.
//
// Index on (post_id, created_at) for thread fetch — the dominant read pattern
// is "comments for this post, newest first." SQLite traverses a B-tree index
// in either direction, so an ORDER BY created_at DESC is served by this index
// without an explicit DESC; the alternative shape (no index) would force a
// sort on every read.
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

// Challenge quota: tracks daily generation count for the protein-shell gate.
// [LAW:single-enforcer] app/lib/quota.ts is the only writer via D1 batch.
// This table is intentionally separate from the app domain schema — it
// serves gate enforcement, not content persistence.
export const challengeQuota = sqliteTable('challenge_quota', {
  date: text('date').primaryKey(),
  count: integer('count').notNull(),
})

// [LAW:single-enforcer] Per-voter daily quota for the 'found' submission
// path. app/lib/found-quota.ts is the only writer via D1 batch. Sibling of
// challenge_quota but keyed by (voter_id, date) rather than date alone —
// challenge_quota is a global ceiling on generated posts, this one is a
// per-voter anti-abuse on user-submitted outbound links.
//
// [LAW:one-type-per-behavior] Distinct table, not a flag/column on
// challenge_quota: the two quotas have different keys, different lifecycles,
// and different operators (admin tuning one knob without disturbing the
// other). Combining them would require a discriminator column that does
// nothing useful at read time.
export const foundSubmissionQuota = sqliteTable(
  'found_submission_quota',
  {
    voterId: text('voter_id').notNull(),
    date: text('date').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.voterId, t.date] })],
)

export type DbUser = typeof users.$inferSelect
export type NewDbUser = typeof users.$inferInsert
export type DbPost = typeof posts.$inferSelect
export type NewDbPost = typeof posts.$inferInsert
export type DbGeneration = typeof generations.$inferSelect
export type NewDbGeneration = typeof generations.$inferInsert
export type DbLineageEdge = typeof lineageEdges.$inferSelect
export type NewDbLineageEdge = typeof lineageEdges.$inferInsert
export type DbUpload = typeof uploads.$inferSelect
export type NewDbUpload = typeof uploads.$inferInsert
export type DbFound = typeof found.$inferSelect
export type NewDbFound = typeof found.$inferInsert
export type DbVote = typeof votes.$inferSelect
export type NewDbVote = typeof votes.$inferInsert
export type DbComment = typeof comments.$inferSelect
export type NewDbComment = typeof comments.$inferInsert
export type DbChallengeQuota = typeof challengeQuota.$inferSelect
export type NewDbChallengeQuota = typeof challengeQuota.$inferInsert
export type DbFoundSubmissionQuota = typeof foundSubmissionQuota.$inferSelect
export type NewDbFoundSubmissionQuota = typeof foundSubmissionQuota.$inferInsert
export type DbPersona = typeof personas.$inferSelect
export type NewDbPersona = typeof personas.$inferInsert
export type DbBacking = typeof backings.$inferSelect
export type NewDbBacking = typeof backings.$inferInsert
export type DbCrown = typeof crowns.$inferSelect
export type NewDbCrown = typeof crowns.$inferInsert
export type DbUtterance = typeof utterances.$inferSelect
export type NewDbUtterance = typeof utterances.$inferInsert
export type DbHonor = typeof honors.$inferSelect
export type NewDbHonor = typeof honors.$inferInsert
export type DbGrace = typeof graces.$inferSelect
export type NewDbGrace = typeof graces.$inferInsert
