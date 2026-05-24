-- slopspot-variety-pl6.2: add the variety taxonomy fields to the generations
-- table per design-docs/variety.md.
--
-- Schema changes:
--   - Drop placeholder nullable columns (style_family, style_subject_template)
--     that 0000_init left in place pending this ticket.
--   - Add four NOT NULL columns: style_family, subject_template, slots_json,
--     aspect_ratio. Each has a DEFAULT so SQLite can ADD COLUMN NOT NULL on
--     the existing non-empty table; the defaults match the doc's backfill
--     sentinel shape ('photoreal', 'T00', empty freeText slots, '1:1').
--
-- Backfill (post-add). Each UPDATE is gated so a re-run cannot clobber
-- chooser-generated rows (T01–T40 with structured slots / no params.aspectRatio):
--   - slots_json: only update rows where subject_template = 'T00' (the
--     freshly-applied default for legacy rows). Chooser-written rows have
--     T01–T40 subject_template and their own structured slots, so this skips
--     them by definition. The DEFAULT clause and the subsequent UPDATE
--     together leave every legacy row with { freeText: <original prompt> }.
--   - aspect_ratio: only update rows whose params_json still carries
--     aspectRatio (legacy fal-flux pre-pl6.2 shape). Chooser rows write
--     aspect_ratio to its own column and never include it in params_json,
--     so they're skipped by the WHERE predicate.
--   - params_json: same WHERE predicate strips aspectRatio from legacy rows
--     only.
--
-- The drizzle-kit migration framework will not re-run an applied migration,
-- so this is defense-in-depth — the guards make the UPDATEs safe even if the
-- file is replayed manually against a partially-migrated DB.
--
-- The status CHECK is unchanged — the new columns are orthogonal to the
-- pending/running/succeeded/failed discriminator.

ALTER TABLE `generations` DROP COLUMN `style_family`;--> statement-breakpoint
ALTER TABLE `generations` DROP COLUMN `style_subject_template`;--> statement-breakpoint
ALTER TABLE `generations` ADD COLUMN `style_family` TEXT NOT NULL DEFAULT 'photoreal';--> statement-breakpoint
ALTER TABLE `generations` ADD COLUMN `subject_template` TEXT NOT NULL DEFAULT 'T00';--> statement-breakpoint
ALTER TABLE `generations` ADD COLUMN `slots_json` TEXT NOT NULL DEFAULT '{"freeText":""}';--> statement-breakpoint
ALTER TABLE `generations` ADD COLUMN `aspect_ratio` TEXT NOT NULL DEFAULT '1:1';--> statement-breakpoint
UPDATE `generations` SET `slots_json` = json_object('freeText', json_extract(`params_json`, '$.prompt')) WHERE `subject_template` = 'T00';--> statement-breakpoint
UPDATE `generations` SET `aspect_ratio` = json_extract(`params_json`, '$.aspectRatio') WHERE json_extract(`params_json`, '$.aspectRatio') IS NOT NULL;--> statement-breakpoint
UPDATE `generations` SET `params_json` = json_remove(`params_json`, '$.aspectRatio') WHERE json_extract(`params_json`, '$.aspectRatio') IS NOT NULL;
