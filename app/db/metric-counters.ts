// [LAW:single-enforcer] The ONE reader/writer of the metric_counters table — the durable
// owner of metric counter state (slopspot-observability-gtz). The /metrics scrape reads from
// here; every invocation boundary (fetch/scheduled/queue) flushes the in-process delta buffer
// to here. [LAW:one-source-of-truth] no other module touches this table.
//
// [LAW:effects-at-boundaries] emit() (app/observability/metrics.ts) stays a synchronous,
// env-free accumulation into a per-isolate buffer so every pure call site can emit without
// threading a binding through it. The D1 effect — the only place a metric count becomes
// durable — lives here and runs at the worker boundary via flushMetrics.

import { sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { metricCounters } from '~/db/schema'
import { d1StmtResult } from '~/db/d1-batch'
import {
  drainPending,
  metricKey,
  remergePending,
  type MetricEntry,
} from '~/observability/metrics'

// [LAW:dataflow-not-control-flow] Apply each delta as `value = value + delta` (a monotonic
// upsert) in one D1 batch. Returns the entries whose statement reported success:false — D1
// batch is NOT transactional, so a per-statement failure resolves WITHOUT throwing (see
// app/db/d1-batch.ts). Returning exactly the failed entries lets the caller re-queue them
// without double-counting the ones that committed. [LAW:no-silent-failure]
export async function applyDeltas(
  env: Env,
  entries: readonly MetricEntry[],
): Promise<{ failed: MetricEntry[] }> {
  const database = db(env)
  const stmts = entries.map((e) =>
    database
      .insert(metricCounters)
      .values({
        key: metricKey(e.name, e.labels),
        name: e.name,
        labels: JSON.stringify(e.labels),
        value: e.value,
      })
      .onConflictDoUpdate({
        target: metricCounters.key,
        set: { value: sql`${metricCounters.value} + ${e.value}` },
      }),
  )
  const [first, ...rest] = stmts
  if (!first) return { failed: [] }
  const results = await database.batch([first, ...rest])
  // A missing result (length mismatch) is treated as failed → re-queued, never silently
  // dropped. [LAW:no-silent-failure]
  const failed = entries.filter((_, i) => {
    const r = results[i]
    return r ? !d1StmtResult(r).success : true
  })
  return { failed }
}

// [LAW:types-are-the-program] Storage-boundary parse: the labels column is text we wrote via
// JSON.stringify, but storage can hold what raw SQL writes, so we re-validate. Corrupt JSON
// throws from JSON.parse; a non-object parse is rejected with a clear message rather than
// laundered into a misshapen render. [LAW:no-silent-failure]
function parseLabels(raw: string): Record<string, string | number> {
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`metric_counters.labels is not a JSON object: ${raw}`)
  }
  return parsed as Record<string, string | number>
}

// The durable view the /metrics scrape renders. Complete (every isolate flushed here) and
// monotonic (only ever value + delta), so it survives cold starts and is correct regardless
// of which isolate serves the scrape — the gtz fix.
export async function readDurableCounters(env: Env): Promise<MetricEntry[]> {
  const rows = await db(env).select().from(metricCounters)
  return rows.map((r) => ({ name: r.name, labels: parseLabels(r.labels), value: r.value }))
}

// [LAW:effects-at-boundaries] Drain this isolate's delta buffer to the durable store. Called
// at each invocation boundary (workers/app.ts: fetch via ctx.waitUntil, scheduled + queue via
// await). Drain is a synchronous snapshot+clear so no emit interleaves; on any flush failure
// the unapplied deltas are returned to the buffer for the next flush, so a transient D1 outage
// never loses counts. [LAW:no-silent-failure]
export async function flushMetrics(env: Env): Promise<void> {
  const drained = drainPending()
  if (drained.length === 0) return
  try {
    const { failed } = await applyDeltas(env, drained)
    if (failed.length > 0) {
      console.error('[metric-flush] partial flush failure; re-queueing deltas', {
        count: failed.length,
      })
      remergePending(failed)
    }
  } catch (err) {
    // D1 batch is non-transactional, so a throw may have committed SOME statements;
    // re-queueing ALL drained risks a bounded double-count but never a silent loss. For a
    // monotonic counter a rare small over-count is acceptable; vanished counts (the bug this
    // fixes) are not.
    console.error('[metric-flush] flush threw; re-queueing all deltas', {
      count: drained.length,
    }, err)
    remergePending(drained)
  }
}
