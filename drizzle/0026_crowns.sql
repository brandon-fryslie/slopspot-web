-- slopspot-daily-rite-coq.1: the crown record — the foundation of The Daily Rite.
--
-- A crowning is persisted ONCE here; the eternal mark on a card, the Calendar
-- entry, and the in-feed badge all DERIVE from a row in this table. There is no
-- is_crowned flag on posts and no stored mark column anywhere — the mark is
-- markFor(lens) computed at read time, the same shape score = SUM(votes.value)
-- takes. [LAW:one-source-of-truth] Crowns are forever: a row persists indefinitely.
--
-- [LAW:types-are-the-program] crowns_lens_shape makes the seven RiteLens arms real
-- at the storage boundary (Drizzle's text-enum is type-level only). The UNIQUE
-- index on rite_day IS the "one ceremony per day" invariant — the liturgical week
-- presides one lens per day, so a second crown for the same day cannot be stored,
-- and the 3am cron re-firing is idempotent by construction (the writer uses
-- ON CONFLICT DO NOTHING against this index).
--
-- presiding records WHO presided at crowning time and is FK-less on purpose
-- (actor-side, like votes.voter_id): a crown is historical fact, so a later persona
-- retirement must never cascade-delete it. decree_json is the Proprietor's
-- serialized Utterance, authored once via utter() and kept forever. post_id FK
-- ON DELETE CASCADE mirrors votes/comments — a crown of a deleted post is
-- meaningless; posts are not normally deleted.
--
-- Idempotency: wrangler records each applied migration in d1_migrations and never
-- re-runs it, so this forward-only DDL executes exactly once.
--
-- Rollback:
--   DROP INDEX `crowns_post_idx`;
--   DROP INDEX `crowns_rite_day_unique`;
--   DROP TABLE `crowns`;

CREATE TABLE `crowns` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`rite_day` text NOT NULL,
	`lens` text NOT NULL,
	`presiding` text NOT NULL,
	`decree_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "crowns_lens_shape" CHECK(`crowns`.`lens` IN ('saint', 'villain', 'heretic', 'relic', 'martyr', 'miracle', 'confession'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crowns_rite_day_unique` ON `crowns` (`rite_day`);
--> statement-breakpoint
CREATE INDEX `crowns_post_idx` ON `crowns` (`post_id`);
