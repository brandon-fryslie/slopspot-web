-- slopspot-efficiency-a5w.2 (E1): materialize SUM(votes.value) into posts.score.
--
-- [LAW:one-source-of-truth][LAW:caches-are-derived] posts.score is a DERIVED cache of the votes
-- table, NOT a second source. The votes table remains authoritative. This migration is the cache's
-- DEFINITION: the same UPDATE that backfills here is the regeneration / self-heal query run if drift
-- is ever suspected (idempotent + total). setVote (app/db/votes.ts) is the single writer that keeps
-- it synced thereafter, recomputing from votes on every vote it applies (recompute-from-source, never
-- an increment — so it is correct under any partial-commit interleaving).
--
-- WHY: the per-read SUM(votes.value) GROUP-BY was the dominant hot-path CPU cost (the 2026-06-04
-- Worker CPU outage). Materializing moves that compute to write time so the feed read is O(page),
-- and makes score an indexable column the `top` cursor can keyset-seek.
--
-- Forward-only. Rollback (pure cache, no data loss — votes is untouched):
--   DROP INDEX posts_score_created_idx;
--   ALTER TABLE posts DROP COLUMN score;

ALTER TABLE posts ADD COLUMN score INTEGER NOT NULL DEFAULT 0;

UPDATE posts SET score = COALESCE(
  (SELECT SUM(v.value) FROM votes v WHERE v.post_id = posts.id), 0
);

CREATE INDEX posts_score_created_idx ON posts (score, created_at, id);
