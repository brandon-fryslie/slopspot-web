// slopspot-cpu-tail — the out-of-band CPU-measurement tail consumer.
//
// Cloudflare delivers every slopspot-web invocation's finalized trace (with the true
// billed cpuTime, which the handler itself CANNOT read) to this Worker's `tail` handler.
// Each TraceItem becomes Prometheus-histogram counter deltas (slopspot_request_cpu_ms_*
// and _wall_ms_*) applied to the SAME durable metric_counters D1 table the app's emit()
// pipeline flushes to; the app's /metrics route renders it and the homelab puller scrapes
// it OUTBOUND. No push, no ingress — the transport is slopspot-observability-gtz's.
//
// [LAW:single-enforcer] app/db/metric-counters.ts stays the ONE writer of the table —
// this worker calls applyDeltas, it does not mint a second write path. This worker is the
// one place per-request CPU is observed; emit() stays the single enforcer for app-domain
// metrics. No overlap.

import { applyDeltas } from '../../app/db/metric-counters'
import { mergeEntry, type MetricEntry } from '../../app/observability/metrics'
import { deltasForItem } from './sample'

type TailEnv = Pick<Env, 'DB'>

// Fold a batch's per-item deltas into one entry per (name, labels) so a TailEvent of N
// invocations costs one D1 statement per distinct series, not N. Uses the same mergeEntry
// rule as the emit buffer. [LAW:one-source-of-truth]
export function mergeDeltas(entries: readonly MetricEntry[]): MetricEntry[] {
  const merged = new Map<string, MetricEntry>()
  for (const e of entries) mergeEntry(merged, e)
  return [...merged.values()]
}

export default {
  async tail(events: TraceItem[], env: TailEnv): Promise<void> {
    const deltas = mergeDeltas(events.flatMap(deltasForItem))
    // An all-event-null batch yields no deltas; an empty applyDeltas would be a wasted
    // D1 round trip, so the dataflow naturally short-circuits on the empty list.
    if (deltas.length === 0) return
    // A tail handler has no re-queue (the trace batch is delivered once), so entries a
    // non-transactional D1 batch failed to commit are DROPPED — loudly. These are latency
    // samples, not critical counts; a loud drop beats a silent one. [LAW:no-silent-failure]
    const { failed } = await applyDeltas(env, deltas)
    if (failed.length > 0) {
      console.error('cpu-tail: dropped histogram deltas (partial D1 batch failure)', {
        count: failed.length,
      })
    }
  },
} satisfies ExportedHandler<TailEnv>
