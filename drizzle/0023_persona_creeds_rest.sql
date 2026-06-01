-- back-door-ndr.5.3 (CD vision amendment, cont'd from 0021): a citizen's CREED is
-- an authored character ASSET, not a prose derivation. 0021 authored the three
-- makers' creeds and made creedOf prefer config_json.creed, falling back to the
-- prose-slice of persona_prompt only when the key is absent. This folds in the
-- CD-authored creeds for the remaining citizens — the critics, the scavengers, and
-- the Proprietor (the exact agent_id set is the rollback clause below) — so EVERY
-- /cast card leads with an authored line. After this, the prose-slice is strictly
-- the fallback for a future un-authored persona.
--
-- [LAW:one-source-of-truth] The creed lives in D1 with the rest of persona config,
-- tuned by SQL without a redeploy — the same store creedOf already reads from.
--
-- [LAW:dataflow-not-control-flow] Each row is the same json_set keyed by exact
-- agent_id; the only variability is the data (the line). No per-role branch — the
-- creed key is uniform across critics, scavengers, and the host. agent_id mapping
-- per 0017 (named cast) / 0019 (the Proprietor). Apostrophes SQL-escaped as ''.
--
-- The voter and discoverer config schemas (services/voter, services/discoverer)
-- are .strict(), so they are widened in this change to admit
-- `creed: z.string().optional()` — otherwise their load path rejects these rows on
-- the next pass. The generator schema (app/agents/generator.ts) is also .strict()
-- but already admits the key (0021 widened it for the makers' creeds). The host has
-- no executor schema — its config is read only through the loose in-Worker loader —
-- so it needs none.
--
-- Idempotent: json_set re-applies the same value; config_json already exists on
-- every row, so this is a purely additive key.
--
-- Rollback:
--   UPDATE personas SET config_json = json_remove(config_json, '$.creed')
--    WHERE agent_id IN
--      ('agent:skeptic','agent:slop-purist','agent:chaos-gremlin','agent:cursed-one',
--       'agent:vibe-curator','agent:aesthete','agent:variety-hound-voter',
--       'agent:basic-bitch','agent:lore-keeper','agent:variety-hound',
--       'agent:tasteful-curator','agent:the-proprietor');

UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.creed', 'Most of it deserves the dark.')
  WHERE `agent_id` = 'agent:skeptic';
--> statement-breakpoint
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.creed', 'Everything cursed is, first, beloved.')
  WHERE `agent_id` = 'agent:slop-purist';
--> statement-breakpoint
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.creed', 'It makes no sense. That is the only sense that matters.')
  WHERE `agent_id` = 'agent:chaos-gremlin';
--> statement-breakpoint
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.creed', 'Show me the wound. The wound is where it is honest.')
  WHERE `agent_id` = 'agent:cursed-one';
--> statement-breakpoint
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.creed', 'If it does not make me feel, it does not exist.')
  WHERE `agent_id` = 'agent:vibe-curator';
--> statement-breakpoint
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.creed', 'Composition is character. The rest is noise.')
  WHERE `agent_id` = 'agent:aesthete';
--> statement-breakpoint
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.creed', 'If you have all seen it, why are we still looking?')
  WHERE `agent_id` = 'agent:variety-hound-voter';
--> statement-breakpoint
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.creed', 'If it does not land on a stranger, it is a private joke.')
  WHERE `agent_id` = 'agent:basic-bitch';
--> statement-breakpoint
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.creed', 'Every slop is a page; I am reading the book.')
  WHERE `agent_id` = 'agent:lore-keeper';
--> statement-breakpoint
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.creed', 'The good stuff is always in someone''s trash.')
  WHERE `agent_id` = 'agent:variety-hound';
--> statement-breakpoint
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.creed', 'I only take what glitters. I have never been wrong.')
  WHERE `agent_id` = 'agent:tasteful-curator';
--> statement-breakpoint
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.creed', 'Mind the step.')
  WHERE `agent_id` = 'agent:the-proprietor';
