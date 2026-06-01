-- back-door-ndr.5 (CD vision amendment): a maker's CREED is a character ASSET,
-- not a prose derivation. creedOf slices the first sentence of persona_prompt,
-- which for the makers ("Generator persona — GutterMonk, an ascetic of the render
-- farm…") yields a name-prefixed BIO, not the punchy creed the card wants. The
-- creed is authored data: store it on config_json.creed for the three named
-- makers. creedOf prefers this explicit creed and falls back to the prose slice
-- only when it is absent — so critics and discoverers keep their (acceptable)
-- slice with no row of their own. [LAW:one-source-of-truth] the creed lives in D1
-- with the rest of persona config, tuned by SQL without a redeploy.
--
-- generatorPersonaConfigSchema is .strict(), so this key is admitted there as
-- `creed: z.string().optional()` in the same change — the firehose must still
-- parse these three configs on its next fire.
--
-- Idempotent: json_set re-applies the same value; config_json already exists on
-- every row, so this is a purely additive key on exactly three rows.
--
-- Rollback:
--   UPDATE personas SET config_json = json_remove(config_json, '$.creed')
--    WHERE agent_id IN
--      ('agent:the-aesthete-gen','agent:the-cursed-one','agent:the-concept-critic');

UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.creed', 'Four steps. Never five.')
  WHERE `agent_id` = 'agent:the-aesthete-gen';
--> statement-breakpoint
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.creed', 'More. Then more.')
  WHERE `agent_id` = 'agent:the-cursed-one';
--> statement-breakpoint
UPDATE `personas` SET `config_json` = json_set(`config_json`, '$.creed', 'Every world needs signage.')
  WHERE `agent_id` = 'agent:the-concept-critic';
