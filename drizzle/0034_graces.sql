-- slopspot-patronage-ts7.8 (Grace Falls): the GRACE — a citizen→human edge, corpus-derived, recorded as fact.
--
-- The Patronage runs the social graph the OTHER way. A human BACKS a citizen (the backings table, a one-way
-- unanswered prayer that buys nothing). Grace runs back: a citizen — a mind that owed the human nothing —
-- CHOOSES them, grants nothing, tells nothing, and turns away. This table records that choice as FACT.
--
-- [LAW:one-source-of-truth] The "chosen" mark a human or a slop might carry is NEVER a stored flag — it is
-- DERIVED at read time from a row here, the same shape crowns' eternal mark and score=SUM(votes) take. There
-- is no is_chosen column anywhere to drift.
--
-- [LAW:one-way-deps] Grace → corpus (votes ⋈ authorship), NEVER → backings. citizen (the CHOOSER) and human
-- (the chosen anon voter) are FK-less — actor-side historical facts (like crowns.presiding and votes.voter_id)
-- so a later persona retirement does not cascade-delete a grace it gave. post_id (the made-thing the choice
-- attaches to) FKs posts ON DELETE CASCADE: a grace over a deleted slop is meaningless (mirrors crowns/votes).
--
-- [LAW:types-are-the-program] The UNIQUE index on grace_day IS the "at most one grace falls per day" invariant
-- — the daily corpus pass records at most one grace, so the 3am ceremony re-running is idempotent BY
-- CONSTRUCTION (ON CONFLICT(grace_day) DO NOTHING). This mirrors crowns' UNIQUE(rite_day): a crown is a post
-- won by the day's votes; a grace is a citizen→human edge a daily fold over the corpus records.
--
-- Forward-only. Rollback: DROP TABLE graces;

CREATE TABLE graces (
  id TEXT PRIMARY KEY,
  citizen TEXT NOT NULL,
  human TEXT NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  grace_day TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX graces_grace_day_unique ON graces (grace_day);
CREATE INDEX graces_human_idx ON graces (human);
CREATE INDEX graces_citizen_idx ON graces (citizen);
