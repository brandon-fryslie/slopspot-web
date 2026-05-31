-- well-foundation-3aj.1: persona is a first-class citizen with a stable handle,
-- and the generator's provider is its MEDIUM (declared on the persona, not picked
-- per-fire by the chooser).
--
-- [RECONCILE A] handle = the canonical citizen URL key (/cast/:handle). A stable,
-- unique, human-readable slug. agent_id stays the INTERNAL id, never in URLs.
-- ADD COLUMN NOT NULL needs a default for existing rows; we backfill real handles
-- from agent_id (already unique slugs: 'agent:guttermonk' -> 'guttermonk') before
-- the UNIQUE index lands. Every later insert supplies its own handle.
ALTER TABLE `personas` ADD COLUMN `handle` text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE `personas` SET `handle` = REPLACE(`agent_id`, 'agent:', '') WHERE `handle` = '';
--> statement-breakpoint
CREATE UNIQUE INDEX `personas_handle_unique` ON `personas` (`handle`);
--> statement-breakpoint
-- [RECONCILE C] Each generator persona declares its medium (a provider id) in
-- config_json. The firehose derives the slop's provider from this medium; the
-- chooser no longer picks one. Map the three starter generators across the three
-- real providers so provider variety emerges from citizen rotation.
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.medium', 'fal-flux') WHERE `agent_id` = 'agent:the-aesthete-gen';
--> statement-breakpoint
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.medium', 'replicate-sdxl') WHERE `agent_id` = 'agent:the-cursed-one';
--> statement-breakpoint
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.medium', 'replicate-ideogram') WHERE `agent_id` = 'agent:the-concept-critic';
