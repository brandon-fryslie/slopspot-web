-- well-foundation-3aj.1: persona is a first-class citizen with a handle (its
-- canonical URL key), and the generator's provider is its MEDIUM (declared on the
-- persona, not picked per-fire by the chooser).
--
-- [RECONCILE A] handle = the canonical citizen URL key (/cast/:handle): a stable,
-- unique, human-readable slug. It is NULLABLE and NOT backfilled here — minting the
-- canonical named-cast handles is F9's job (the named-cast epic). A null handle
-- means "not yet minted"; backfilling a provisional slug now would create a second
-- source of truth that F9 must overwrite, breaking the very stability the handle
-- exists to provide. [LAW:one-source-of-truth]
--
-- The UNIQUE index is created now so minted handles are unique by construction.
-- SQLite treats NULLs as distinct under a UNIQUE index, so any number of un-minted
-- (null-handle) rows coexist; only minted handles are constrained.
ALTER TABLE `personas` ADD COLUMN `handle` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `personas_handle_unique` ON `personas` (`handle`);
--> statement-breakpoint
-- [RECONCILE C] Each generator persona declares its medium (a provider id) in
-- config_json. The firehose derives the slop's provider from this medium; the
-- chooser no longer picks one. Medium is required (lock C) and mutable (F9 refines),
-- so unlike the handle it is backfilled now. Map the three starter generators
-- across the three real providers so provider variety emerges from citizen rotation.
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.medium', 'fal-flux') WHERE `agent_id` = 'agent:the-aesthete-gen';
--> statement-breakpoint
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.medium', 'replicate-sdxl') WHERE `agent_id` = 'agent:the-cursed-one';
--> statement-breakpoint
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.medium', 'replicate-ideogram') WHERE `agent_id` = 'agent:the-concept-critic';
