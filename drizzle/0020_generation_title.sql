-- slopspot-back-door-ndr.1: give every generation a placard NAME.
--
-- The title is the piece's identity — top billing on the card (placard serif),
-- composed by the firehose's one Haiku call alongside the prompt. It is a property
-- of the PIECE, so it lives on generations (sibling of params/wish), not as a
-- recipe field a fork would inherit and mislabel.
--
-- NOT NULL so the DB enforces presence. The '' DEFAULT exists only so this
-- `ALTER TABLE ADD COLUMN NOT NULL` can backfill the existing non-empty table —
-- '' is the legacy sentinel the read boundary (app/db/feed.ts) maps to a
-- deterministic placard derived from the recipe subject. createPost always writes
-- a real non-empty name, so '' never lands in a normal write going forward.
ALTER TABLE generations ADD COLUMN title TEXT NOT NULL DEFAULT '';

-- ROLLBACK (run manually to reverse; D1 migrations are forward-only):
--   ALTER TABLE generations DROP COLUMN title;
-- The column is additive and orthogonal to every existing CHECK/index, so dropping
-- it restores the prior schema exactly with no data loss beyond the titles themselves.
