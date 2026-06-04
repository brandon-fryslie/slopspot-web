-- slopspot-voice-w2v.1 (Verdicts Aloud): the Utterance becomes a FIRST-CLASS ADDRESSABLE RECORD.
--
-- [LAW:one-source-of-truth][LAW:locality-or-seam] Until now an Utterance (app/lib/voice.ts) was a
-- transient utter() return, persisted only inlined on the act it narrated (generations.remark_json,
-- crowns.decree_json). The Voice epic needs it addressable: .2 (Feud Engine) composes a feud by
-- RELATING utterance records (an edge over THIS table) and .5 (Living Cast Pages) reads a citizen's
-- utterances as a feed — a transient display line gives them nothing to relate or list. This is THE
-- lock: .2-.6 build edges/reads OVER these rows; they never reshape .1.
--
-- Keyed by (speaker, about-target, via-occasion, at-time) exactly as the ticket locks. The shape
-- mirrors the Utterance union (voice.ts utteranceSchema): spoke carries text, withheld carries a
-- reason — never both, never neither. The CHECK makes the cross-arm illegal states unrepresentable,
-- the same discipline as generations_status_shape.
--
-- occasion is the CLOSED union (the-voice-layer.md one catalog): verdict is implemented now; the
-- reserved arms are listed so a later child adds one as data, not a schema change.
--
-- The UNIQUE (speaker, target_post_id, occasion) enforces ONE current utterance per citizen per slop
-- per occasion — a re-vote upserts the latest verdict (matching the votes upsert model). SQLite treats
-- NULLs as distinct under a unique index, so post-less occasions (eulogy/chrome) never collide.
--
-- Forward-only. Rollback: DROP TABLE utterances;

CREATE TABLE utterances (
  id              TEXT PRIMARY KEY,
  speaker         TEXT NOT NULL,
  occasion        TEXT NOT NULL,
  target_post_id  TEXT REFERENCES posts(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  text            TEXT,
  withheld_reason TEXT,
  created_at      INTEGER NOT NULL,

  CHECK (occasion IN ('caption','verdict','remark','decree','chrome','reply','comment','eulogy','birth')),
  CHECK (
    (kind = 'spoke'    AND text IS NOT NULL AND withheld_reason IS NULL)
    OR
    (kind = 'withheld' AND withheld_reason IS NOT NULL AND text IS NULL
       AND withheld_reason IN ('characteristic-silence','indifferent','beneath-comment','unavailable'))
  )
);

-- Co-presence + per-slop read (the verdict lines on one slop, newest first).
CREATE INDEX utterances_target_created_idx ON utterances (target_post_id, created_at);
-- Per-citizen ledger (.5 Living Cast Pages; .2 relating a speaker's record).
CREATE INDEX utterances_speaker_created_idx ON utterances (speaker, created_at);
-- One current utterance per citizen, per slop, per occasion (re-vote upserts).
CREATE UNIQUE INDEX utterances_speaker_target_occasion_unique ON utterances (speaker, target_post_id, occasion);
