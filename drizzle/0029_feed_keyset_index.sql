-- slopspot-efficiency-a5w.2 (E1): make the new/hot keyset cursor an index SEEK with no temp sort.
--
-- The new/hot feed cursor orders by (created_at, id). posts.id is a TEXT PRIMARY KEY — NOT the
-- rowid — so it is absent from posts_created_at_idx's (created_at)-only leaves, and SQLite adds a
-- "USE TEMP B-TREE FOR LAST TERM OF ORDER BY" to sort the id tie-break (MEASURED via EXPLAIN, not
-- assumed). A composite (created_at, id) index carries both, so the keyset becomes a COVERING SEARCH
-- with no temp sort. It strictly supersedes the (created_at)-only index — a leading-column prefix
-- serves every query the old index did (the window range scans, the chronological reads) — so the
-- old one is dropped rather than kept as dead write-amplification.
--
-- Pairs with the row-value cursor predicate in app/lib/sort-mode.ts (cursorFilter): `(created_at,
-- id) < (?, ?)` is what SQLite folds into the seek; the OR-chain form would SCAN+filter instead.
--
-- Forward-only. Rollback (pure index swap, no data change):
--   DROP INDEX posts_created_at_id_idx;
--   CREATE INDEX posts_created_at_idx ON posts (created_at);

DROP INDEX IF EXISTS posts_created_at_idx;

CREATE INDEX posts_created_at_id_idx ON posts (created_at, id);
