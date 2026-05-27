-- slopspot-content-sources-svq.1: extend Content with the 'found' arm.
-- Reddit-style outbound link submissions. The linked media itself is NOT
-- rehosted — only the optional thumbnail flows through ~/storage/ingest, and
-- its Media JSON lives in thumbnail_json the same way uploads.asset_json holds
-- the upload's Media. url + title are NOT NULL because the domain variant
-- requires both; description and thumbnail_json are nullable because the
-- domain marks them optional. [LAW:types-are-the-program] every legal Content
-- state is representable, every illegal one is not.
--
-- The posts.content_kind CHECK must be widened from ('generation', 'upload')
-- to ('generation', 'upload', 'found'). SQLite ALTER TABLE cannot modify a
-- CHECK constraint in place, so we rebuild the table via the standard
-- new-table → copy → drop → rename dance. Foreign keys from sibling tables
-- (generations, uploads, comments, votes, the new `found`) point at posts(id)
-- with ON DELETE CASCADE; PRAGMA foreign_keys=OFF prevents cascade-delete from
-- firing during the swap. The original posts_created_at_idx index is dropped
-- with the old table and recreated at the end.

CREATE TABLE `found` (
	`post_id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`thumbnail_json` text,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`content_kind` text NOT NULL,
	`origin_json` text NOT NULL,
	CONSTRAINT "posts_content_kind_shape" CHECK("__new_posts"."content_kind" IN ('generation', 'upload', 'found'))
);
--> statement-breakpoint
INSERT INTO `__new_posts`("id", "created_at", "content_kind", "origin_json") SELECT "id", "created_at", "content_kind", "origin_json" FROM `posts`;--> statement-breakpoint
DROP TABLE `posts`;--> statement-breakpoint
ALTER TABLE `__new_posts` RENAME TO `posts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `posts_created_at_idx` ON `posts` (`created_at`);
