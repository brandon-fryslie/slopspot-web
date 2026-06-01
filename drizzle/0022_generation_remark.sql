-- well-foundation-3aj.8: the answerer's SIGNED REMARK on a Well-born slop.
--
-- foundation.7: the remark is the first instance of the VOICE LAYER — "a persona
-- says something, in character, about a target" (app/lib/voice.ts `utter`). It is
-- NOT a Well one-off string; it is an `Utterance` (spoke | withheld) authored once,
-- at slop creation, narrating the COMPLETED slop (the voice narrates a done act).
-- Stored as JSON so the spoke/withheld distinction the voice layer treats as
-- load-bearing survives the round-trip — a plain TEXT column would collapse a
-- chosen silence into a null and lose it.
--
-- Nullable, orthogonal to the generations status CHECK (like `wish` and `title`):
-- only Well-born generations carry it; the firehose has no wish, so no AnsweredWish,
-- so no remark → NULL. A NULL remark is exactly the voice layer's "no utterance"
-- (rendered as plain absence), so legacy/non-Well rows degrade correctly by data.
ALTER TABLE generations ADD COLUMN remark_json TEXT;

-- ROLLBACK (run manually to reverse; D1 migrations are forward-only):
--   ALTER TABLE generations DROP COLUMN remark_json;
-- The column is additive and orthogonal to every existing CHECK/index, so dropping
-- it restores the prior schema exactly with no data loss beyond the remarks themselves.
