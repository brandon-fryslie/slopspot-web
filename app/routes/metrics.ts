// [LAW:single-enforcer] The one place the durable counter store exits into the scrape world.
// readDurableCounters (app/db/metric-counters.ts) is the single read of the metric_counters
// table; formatPrometheus (app/observability/metrics.ts) is the single formatter. This route
// composes them — no second accumulator, no parallel path, no reformatting.
//
// [LAW:one-source-of-truth] This endpoint reads the DURABLE D1 view, not a per-isolate
// in-memory map. Every invocation (fetch/scheduled/queue) flushes its delta buffer to D1, so
// the scrape is COMPLETE regardless of which isolate serves it and the counters survive cold
// starts (slopspot-observability-gtz). The homelab slopspot-metrics-puller scrapes this
// endpoint over its existing outbound pull — unchanged; only the backing moved to D1.

import type { Route } from './+types/metrics'
import { formatPrometheus } from '~/observability/metrics'
import { readDurableCounters } from '~/db/metric-counters'

export async function loader({ context }: Route.LoaderArgs) {
  const entries = await readDurableCounters(context.cloudflare.env)
  return new Response(formatPrometheus(entries), {
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
  })
}
