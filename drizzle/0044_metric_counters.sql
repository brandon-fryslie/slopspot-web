-- slopspot-observability-gtz: durable metric counter store. [LAW:one-source-of-truth]
--
-- THE BUG (verified against VictoriaMetrics): the only ingestion is the homelab
-- slopspot-metrics-puller scraping /metrics, which read a PER-ISOLATE in-memory counter
-- map. Cron/scheduled/queue metrics (slopspot.firehose.fire, slopspot.post.created,
-- ceremonies) are emitted in a DIFFERENT isolate than the one a /metrics fetch hits, so
-- they returned ZERO series despite being live. Counters also reset on cold start, making
-- increase()/rate() unreliable for low-frequency events. A [LAW:no-silent-failure] hole:
-- the dashboard read as truth while undercounting.
--
-- THE FIX: one durable owner of counter state. Every isolate drains its in-process delta
-- buffer to this table (value = value + delta), and /metrics reads from here, so the scrape
-- is COMPLETE regardless of which isolate serves it and the counter survives cold starts.
-- NO new ingress — the homelab outbound pull is unchanged; only the backing of /metrics moves.
--
-- ROLLBACK: purely additive (new table, no existing data touched). Reverse is
-- `DROP TABLE metric_counters;` with zero blast radius on any other table.
CREATE TABLE metric_counters (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  labels TEXT NOT NULL,
  value REAL NOT NULL
);
