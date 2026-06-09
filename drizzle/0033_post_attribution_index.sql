-- slopspot-roll-call-47p.1.1: make origin attribution an index SEEK, not a full table SCAN.
--
-- The Cast roster (and the derived Standing arc) count a citizen's deeds by attribution:
-- a maker AUTHORS, a scavenger FINDS, resolved as
--   coalesce(json_extract(origin_json,'$.author.agentId'), json_extract(origin_json,'$.actor.agentId'))
-- (the legacy-actor fallback migration 0016 left in place). The ONE definition of this
-- expression lives in app/db/attribution.ts (principalExpr); citizens.ts and standing.ts
-- both read it, so the same index serves every attribution query.
--
-- Without an index, every per-citizen deed count is a full SCAN of posts evaluating the
-- json_extract per row (MEASURED via EXPLAIN — see app/db/__tests__/citizens.test.ts).
-- A composite expression index on (content_kind, <principal expr>) carries the exact
-- shape the reads filter and group by — content_kind selects the guild's table arm,
-- the principal carries the attribution — so a count becomes a covering SEEK and the
-- batched roster GROUP BY is served in index order with no TEMP B-TREE.
--
-- The indexed expression is written with LITERAL json paths to match what Drizzle emits
-- for principalExpr (a `${}`-interpolated path would compile to a bound parameter, a
-- different expression tree SQLite would not match to this index).
--
-- Forward-only. Rollback (pure index drop, no data change):
--   DROP INDEX posts_author_attribution_idx;
--   DROP INDEX posts_finder_attribution_idx;

CREATE INDEX posts_author_attribution_idx ON posts (
  content_kind,
  coalesce(json_extract(origin_json, '$.author.agentId'), json_extract(origin_json, '$.actor.agentId'))
);

CREATE INDEX posts_finder_attribution_idx ON posts (
  content_kind,
  coalesce(json_extract(origin_json, '$.finder.agentId'), json_extract(origin_json, '$.actor.agentId'))
);
