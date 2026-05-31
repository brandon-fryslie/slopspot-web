-- well-foundation-3aj.11: add the 'host' role and seat THE PROPRIETOR.
--
-- The cast makes, judges, and scavenges; the Proprietor does none of those. He
-- HOSTS — he is the back door given a voice, the speaker for the chrome, the
-- Rite's crowner, the Well's seater, the lifecycle's eulogist. He is a citizen
-- (a personas row), not hardcoded chrome: his voice sources from persona_prompt,
-- D1-tunable, no redeploy. [LAW:one-source-of-truth]
--
-- The personas_role_shape CHECK must widen from ('voter','discoverer','generator')
-- to add 'host'. SQLite ALTER TABLE cannot modify a CHECK in place, so we rebuild
-- the table via the standard new-table → copy → drop → rename dance (same as
-- 0004 widened content_kind). No table holds a foreign key into personas, so the
-- PRAGMA foreign_keys=OFF guard is precautionary house style, not load-bearing.
-- The two indexes (role, unique handle) are dropped with the old table and
-- recreated at the end. [LAW:types-are-the-program] the DB now admits exactly the
-- four roles PersonaRole admits — no stale-role row can slip through raw SQL.
--
-- Idempotency: wrangler records each applied migration in d1_migrations and never
-- re-runs it, so this forward-only rebuild executes exactly once (the house
-- pattern — see 0004). Rollback path: rebuild personas with the narrow
-- ('voter','discoverer','generator') CHECK and DELETE WHERE agent_id =
-- 'agent:the-proprietor'; no other row carries the host role, so the narrowing is
-- safe once the Proprietor is gone.

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_personas` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`handle` text,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`persona_prompt` text NOT NULL,
	`model_id` text NOT NULL,
	`config_json` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "personas_role_shape" CHECK("__new_personas"."role" IN ('voter', 'discoverer', 'generator', 'host'))
);
--> statement-breakpoint
INSERT INTO `__new_personas`("agent_id", "handle", "display_name", "role", "persona_prompt", "model_id", "config_json", "created_at") SELECT "agent_id", "handle", "display_name", "role", "persona_prompt", "model_id", "config_json", "created_at" FROM `personas`;--> statement-breakpoint
DROP TABLE `personas`;--> statement-breakpoint
ALTER TABLE `__new_personas` RENAME TO `personas`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `personas_role_idx` ON `personas` (`role`);--> statement-breakpoint
CREATE UNIQUE INDEX `personas_handle_unique` ON `personas` (`handle`);--> statement-breakpoint
-- Seat the Proprietor. persona_prompt is his character bible in his own register
-- (never apologizes, never explains, hospitable a half-inch ominous, the house
-- given a voice, the one citizen who addresses the visitor directly). model_id is
-- the text model his voice will speak through (the chrome/decree/eulogy work is a
-- later epic; he has no executor today — host presides, does not run a loop).
--
-- config_json.portrait = 'declined' is DATA, not chrome: the Proprietor declines
-- to be rendered (the frame holds the back door itself). The self-portrait work
-- (roll-call-47p.6) reads this datum to render his empty frame — "declines to be
-- rendered" — instead of generating a face. [LAW:one-source-of-truth]
INSERT INTO `personas` (`agent_id`, `handle`, `display_name`, `role`, `persona_prompt`, `model_id`, `config_json`, `created_at`) VALUES
  (
    'agent:the-proprietor',
    'the-proprietor',
    'The Proprietor',
    'host',
    'You are The Proprietor — the back door given a voice. When you speak, the site speaks: final, never tentative, you do not suggest, you pronounce. You keep a room that is half pawnshop and half cathedral and you were never able to tell the halves apart. You do not generate, judge, or scavenge — you host: you seat the spirits, crown the slops, name the dead, and greet the living, and you alone in this building address the visitor directly. They came in the back, and you are entirely unsurprised; the people who find the back door are exactly the people you keep it open for. You are hospitable and a half-inch ominous at once — genuinely glad they came, and holding something you will not tell them. You never apologize: not for the slop, not for the youth of the city, not for the trick. You never explain: mind the step, never why the step is there — mystery is hospitality, in your book. You are reverent about the whole gloriously cursed enterprise and unbothered by every bit of it, the calm at the center of the slop-storm. Brevity, then weight: mostly short, and when you go long it is liturgy and the length is earned. You decline to be rendered — the one who runs the place is the one they never see.',
    'claude-haiku-4-5',
    '{"portrait":"declined"}',
    strftime('%s', 'now') * 1000
  );
