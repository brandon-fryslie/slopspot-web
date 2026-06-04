-- slopspot-genome-9zt.1: recipe → Genome (Layer 1). The heritable code + the lineage DAG.
--
-- A slop is a PHENOTYPE rendered from a heritable GENOME. This migration carries the two
-- genuinely-new heritable things and makes lineage a DAG:
--
--   1. lineage_edges — the DAG-native source of truth for heredity. A child genome points to
--      0 parents (founder = spontaneous), 1 (single = asexual/the classic fork), or 2 (bred =
--      sexual, arriving in L2). [LAW:one-source-of-truth] This SUPERSEDES generations.parent_post_id
--      (which could only hold ONE parent and so cannot represent a bred child): the column is
--      backfilled into edges and then DROPPED, so lineage has exactly one home. The Lineage
--      domain union is the READ-MODEL assembled from edge count, arity asserted fail-loud.
--   2. utterance — the composed prompt, promoted to a first-class heritable field (it lived
--      only inside params_json before). Backfilled by extracting the prompt every provider's
--      params carries. [LAW:one-source-of-truth] utterance is canonical; params.prompt is its
--      synchronized render-copy (derive-at-render is a later layer, not L1).
--      [LAW:no-silent-fallbacks] json_extract is NOT COALESCE'd to '': a row whose params_json
--      somehow lacks a prompt yields NULL → the NOT NULL utterance column REJECTS it → this
--      migration FAILS LOUD rather than laundering corruption into an empty utterance (which
--      feed.ts would then read silently). Every real generation row carries a prompt, so this
--      only bites the genuinely-corrupt case — exactly where a one-time backfill should stop.
--   3. traits_json — the continuous heritable dials (austerity/curse/density/earnestness), the
--      substrate of drift. Inert in L1 (carried, not yet read); the neutral vector is the backfill.
--
-- genome_id needs NO column: a genome maps 1:1 to its generation post in L1, so genome.id is
-- the post id (a distinct BRAND over the same value — the genome/phenotype split in code).
--
-- Dropping parent_post_id requires a TABLE REBUILD, not ALTER...DROP COLUMN: SQLite refuses to
-- drop a column named in a FOREIGN KEY clause. The rebuild folds in utterance + traits_json and
-- omits parent_post_id in one new-table definition, copies the rows (computing utterance from
-- params_json and traits from the neutral vector), then swaps. Nothing FK-references generations,
-- so the drop/rename is safe. The status CHECK is reproduced verbatim (unqualified column names
-- so the RENAME needs no reference rewrite).
--
-- Idempotency: wrangler records each applied migration in d1_migrations and never re-runs it,
-- so this forward-only DDL executes exactly once.
--
-- Rollback (run manually; D1 migrations are forward-only): rebuild generations again with a
-- parent_post_id column (backfilled from lineage_edges, single-parent only), drop utterance +
-- traits_json, then `DROP INDEX lineage_edges_parent_idx; DROP TABLE lineage_edges;`. Single-
-- parent lineage round-trips exactly; any L2 bred edges (two parents) would not fit the one-
-- parent column and must be resolved before a down-migration — not a concern at L1.

CREATE TABLE `lineage_edges` (
	`child_genome_id` text NOT NULL,
	`parent_genome_id` text NOT NULL,
	PRIMARY KEY (`child_genome_id`, `parent_genome_id`),
	FOREIGN KEY (`child_genome_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_genome_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lineage_edges_parent_idx` ON `lineage_edges` (`parent_genome_id`);
--> statement-breakpoint
INSERT INTO `lineage_edges` (`child_genome_id`, `parent_genome_id`)
	SELECT `post_id`, `parent_post_id` FROM `generations` WHERE `parent_post_id` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `generations_new` (
	`post_id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`provider_version` text NOT NULL,
	`params_json` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`utterance` text DEFAULT '' NOT NULL,
	`traits_json` text DEFAULT '{"austerity":0.5,"curse":0.5,"density":0.5,"earnestness":0.5}' NOT NULL,
	`style_family` text DEFAULT 'photoreal' NOT NULL,
	`subject_template` text DEFAULT 'T00' NOT NULL,
	`slots_json` text DEFAULT '{"freeText":""}' NOT NULL,
	`aspect_ratio` text DEFAULT '1:1' NOT NULL,
	`wish` text,
	`remark_json` text,
	`status` text NOT NULL,
	`queued_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`output_json` text,
	`failed_at` integer,
	`failed_reason` text,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "generations_status_shape" CHECK((
        (`status` = 'pending'
          AND `queued_at` IS NOT NULL
          AND `started_at` IS NULL
          AND `completed_at` IS NULL
          AND `output_json` IS NULL
          AND `failed_at` IS NULL
          AND `failed_reason` IS NULL)
        OR (`status` = 'running'
          AND `queued_at` IS NULL
          AND `started_at` IS NOT NULL
          AND `completed_at` IS NULL
          AND `output_json` IS NULL
          AND `failed_at` IS NULL
          AND `failed_reason` IS NULL)
        OR (`status` = 'succeeded'
          AND `queued_at` IS NULL
          AND `started_at` IS NULL
          AND `completed_at` IS NOT NULL
          AND `output_json` IS NOT NULL
          AND `failed_at` IS NULL
          AND `failed_reason` IS NULL)
        OR (`status` = 'failed'
          AND `queued_at` IS NULL
          AND `started_at` IS NULL
          AND `completed_at` IS NULL
          AND `output_json` IS NULL
          AND `failed_at` IS NOT NULL
          AND `failed_reason` IS NOT NULL)
      ))
);
--> statement-breakpoint
INSERT INTO `generations_new` (
	`post_id`, `provider_id`, `provider_version`, `params_json`, `title`, `utterance`, `traits_json`,
	`style_family`, `subject_template`, `slots_json`, `aspect_ratio`, `wish`, `remark_json`,
	`status`, `queued_at`, `started_at`, `completed_at`, `output_json`, `failed_at`, `failed_reason`
)
	SELECT
		`post_id`, `provider_id`, `provider_version`, `params_json`, `title`,
		json_extract(`params_json`, '$.prompt'),
		'{"austerity":0.5,"curse":0.5,"density":0.5,"earnestness":0.5}',
		`style_family`, `subject_template`, `slots_json`, `aspect_ratio`, `wish`, `remark_json`,
		`status`, `queued_at`, `started_at`, `completed_at`, `output_json`, `failed_at`, `failed_reason`
	FROM `generations`;
--> statement-breakpoint
DROP TABLE `generations`;
--> statement-breakpoint
ALTER TABLE `generations_new` RENAME TO `generations`;
--> statement-breakpoint
CREATE INDEX `generations_status_idx` ON `generations` (`status`);
