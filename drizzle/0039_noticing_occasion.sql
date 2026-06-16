-- slopspot-genome-brs (The Noticing): when the firehose detects a monoculture, a citizen UTTERS an
-- observation of the sameness — the city NOTICES the convergence (it does NOT declare an era for it;
-- doctrine/on-eras.md). The noticing persists through the EXISTING utterances single writer
-- (recordUtterance) — occasion as DATA, the seam the voice layer was built to grow (the-voice-layer.md
-- "one catalog"). The only schema residue is widening the utterances `occasion` CHECK from 0035's set to
-- include 'noticing', so a noticing row is storable.
--
-- SQLite ALTER TABLE cannot modify a CHECK in place, so we rebuild the table via the standard
-- new-table → copy → drop → rename dance (the same idiom 0035 used to add 'grace'). The FK
-- target_post_id → posts(id) ON DELETE CASCADE and BOTH CHECKs and all three indexes are reproduced;
-- PRAGMA foreign_keys=OFF prevents the cascade from firing during the swap. The data is occasion-agnostic,
-- so the INSERT…SELECT copies every existing utterance verbatim.
--
-- Forward-only. Rollback: rebuild with the pre-noticing CHECK (and delete any occasion='noticing' rows first).

PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE __new_utterances (
  id              TEXT PRIMARY KEY,
  speaker         TEXT NOT NULL,
  occasion        TEXT NOT NULL,
  target_post_id  TEXT REFERENCES posts(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  text            TEXT,
  withheld_reason TEXT,
  created_at      INTEGER NOT NULL,

  CHECK (occasion IN ('caption','verdict','remark','decree','chrome','reply','comment','eulogy','birth','grace','noticing')),
  CHECK (
    (kind = 'spoke'    AND text IS NOT NULL AND withheld_reason IS NULL)
    OR
    (kind = 'withheld' AND withheld_reason IS NOT NULL AND text IS NULL
       AND withheld_reason IN ('characteristic-silence','indifferent','beneath-comment','unavailable'))
  )
);--> statement-breakpoint
INSERT INTO __new_utterances("id", "speaker", "occasion", "target_post_id", "kind", "text", "withheld_reason", "created_at")
  SELECT "id", "speaker", "occasion", "target_post_id", "kind", "text", "withheld_reason", "created_at" FROM utterances;--> statement-breakpoint
DROP TABLE utterances;--> statement-breakpoint
ALTER TABLE __new_utterances RENAME TO utterances;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX utterances_target_created_idx ON utterances (target_post_id, created_at);--> statement-breakpoint
CREATE INDEX utterances_speaker_created_idx ON utterances (speaker, created_at);--> statement-breakpoint
CREATE UNIQUE INDEX utterances_speaker_target_occasion_unique ON utterances (speaker, target_post_id, occasion);
