-- slopspot-beyond-image-poj.4 (The Firehose Writes): the city's HONORS — once-ever, first-of-kind decrees.
--
-- THE CEREMONIAL MARK. When the city's first verse-citizen exists, the Proprietor decrees it THE CITY'S
-- FIRST POET and that fact is marked here, permanently. 'First poet' is DERIVED, never seeded: the rite
-- reads STATE (a verse-citizen exists AND no first-poet honor recorded → decree the EARLIEST by created_at),
-- so it fires once ever and catches the first poet even if it was born before this ceremony existed.
--
-- [LAW:types-are-the-program] `kind` is the PRIMARY KEY — that single choice IS the whole invariant. At most
-- one honor per kind is representable, so "fires once ever" is enforced by construction; the rite writes with
-- ON CONFLICT(kind) DO NOTHING, so a concurrent or retried fire converges on the one row without a race. This
-- mirrors crowns' UNIQUE(rite_day) "one ceremony per day" — but an honor is a CITIZEN marked for a first that
-- happens once in the city's life, not a POST won by the day's votes that recurs nightly. Different behavior,
-- different table.
--
-- decree_json is the Proprietor's whole Utterance (the crowns pattern — the decree lives in its ceremony
-- table, never an utterances row). agent_id is the honored citizen, a plain AgentId with no FK, so the
-- historical mark stands independent of the persona row (the same way utterances.speaker carries no FK).
--
-- Forward-only. Rollback: DROP TABLE honors;

CREATE TABLE honors (
  kind TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  decree_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
