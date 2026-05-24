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
-- Backfill (post-add, idempotent):
--   - slots_json gets the original params_json.prompt as freeText.
--   - aspect_ratio gets params_json.aspectRatio (was carried in params on the
--     pre-pl6.2 schema for fal-flux). Rows without an aspectRatio in params
--     keep the column's default of '1:1' (only legacy sdxl-mock rows could
--     hit this case, and none exist in prod).
--   - params_json has its aspectRatio key stripped so going-forward reads see
--     the new params shape (no aspectRatio in params; it lives on the row).
--
-- The status CHECK is unchanged — the new columns are orthogonal to the
-- pending/running/succeeded/failed discriminator.

ALTER TABLE `generations` DROP COLUMN `style_family`;--> statement-breakpoint
ALTER TABLE `generations` DROP COLUMN `style_subject_template`;--> statement-breakpoint
ALTER TABLE `generations` ADD COLUMN `style_family` TEXT NOT NULL DEFAULT 'photoreal';--> statement-breakpoint
ALTER TABLE `generations` ADD COLUMN `subject_template` TEXT NOT NULL DEFAULT 'T00';--> statement-breakpoint
ALTER TABLE `generations` ADD COLUMN `slots_json` TEXT NOT NULL DEFAULT '{"freeText":""}';--> statement-breakpoint
ALTER TABLE `generations` ADD COLUMN `aspect_ratio` TEXT NOT NULL DEFAULT '1:1';--> statement-breakpoint
UPDATE `generations` SET `slots_json` = json_object('freeText', json_extract(`params_json`, '$.prompt'));--> statement-breakpoint
UPDATE `generations` SET `aspect_ratio` = json_extract(`params_json`, '$.aspectRatio') WHERE json_extract(`params_json`, '$.aspectRatio') IS NOT NULL;--> statement-breakpoint
UPDATE `generations` SET `params_json` = json_remove(`params_json`, '$.aspectRatio') WHERE json_extract(`params_json`, '$.aspectRatio') IS NOT NULL;
