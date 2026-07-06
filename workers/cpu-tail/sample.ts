// TraceItem -> durable histogram deltas. Pure; the worker entry (index.ts) does only I/O.
//
// [LAW:types-are-the-program] TraceItem.event is a runtime discriminated union whose
// variants include empty objects (Connect/Custom) no structural switch can narrow, so
// exhaustiveness is enforced on the closed Handler set WE own (fetch/scheduled/other)
// via assertNever — a new handler class must be labeled or the build breaks. New runtime
// event variants collapse into the `other` bucket by design (bounded cardinality).
//
// KEY FACT: cpuTime/wallTime live ONLY on TraceItem (a tail-consumer object), never on
// the fetch/scheduled handler context. Reading them here adds ZERO CPU to the measured
// request path — the measurement cannot regress what it measures.
//
// [LAW:one-source-of-truth] The metric shape is a PROMETHEUS HISTOGRAM expressed as
// monotonic counters (_bucket{le}/_sum/_count) — exactly what the durable metric_counters
// store already holds — so per-path p95 CPU (histogram_quantile in VictoriaMetrics) rides
// the existing no-ingress /metrics scrape. There is no push path and no second pipeline;
// the owner vetoed any internet-facing write ingress to the homelab (a5w.5.3 WONTFIX).

import { canonicalizeRoute } from '../../app/lib/route-canonicalize'
import { ROUTE_PATTERNS } from '../../app/lib/route-patterns.generated'
import type { MetricEntry } from '../../app/observability/metrics'

export const CPU_METRIC = 'slopspot_request_cpu_ms' as const
export const WALL_METRIC = 'slopspot_request_wall_ms' as const

// Bucket upper bounds in ms. CPU resolves finely in the 1–100ms band where the serving
// budget lives; wall stretches to 30s because cron/queue invocations legitimately wait on
// provider polling. Both end at +Inf (added by histogramDeltas), so no observation is lost.
export const CPU_BUCKETS_MS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000] as const
export const WALL_BUCKETS_MS = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000] as const

// The closed set of handler classes the metric distinguishes. [LAW:types-are-the-program]
// `assertNever` over this union (in labelsFor) makes adding a Handler value without
// labeling it a compile error — exhaustiveness is enforced on the set WE own, since the
// runtime's event union includes empty-object variants no structural switch can narrow.
type Handler = 'fetch' | 'scheduled' | 'other'

type Attribution = { handler: Handler; route: string }

// Discriminate the runtime event union into (handler, route). The discriminator is the
// structural shape of each variant — fetch carries `request`, scheduled carries `cron`;
// every other variant (rpc/connect/alarm/queue/email/tail/custom/websocket) is the
// `other` bucket. [LAW:dataflow-not-control-flow] every event flows through the same
// path; the variant (data), not a flag, decides the attribution.
function attribute(event: NonNullable<TraceItem['event']>): Attribution {
  if ('request' in event) {
    return {
      handler: 'fetch',
      route: canonicalizeRoute(new URL(event.request.url).pathname, ROUTE_PATTERNS),
    }
  }
  if ('cron' in event) {
    return { handler: 'scheduled', route: `cron:${event.cron}` }
  }
  return { handler: 'other', route: 'other' }
}

const assertNever = (x: never): never => {
  throw new Error(`cpu-tail: unhandled handler class: ${JSON.stringify(x)}`)
}

// [LAW:types-are-the-program] Exhaustive over the Handler union: a new handler class
// must be given a label here or the build fails at the `: never` branch.
function labelsFor(attr: Attribution, outcome: string): Record<string, string> {
  switch (attr.handler) {
    case 'fetch':
    case 'scheduled':
    case 'other':
      return { route: attr.route, handler: attr.handler, outcome }
    default:
      return assertNever(attr.handler)
  }
}

// One observation -> the Prometheus-histogram counter deltas it implies: +1 on every
// CUMULATIVE bucket whose upper bound covers the value (le is a label, "+Inf" always
// counts), value into _sum, +1 into _count. [LAW:dataflow-not-control-flow] the value
// decides which entries exist; the fold is the same for every observation.
export function histogramDeltas(
  family: string,
  labels: Record<string, string>,
  value: number,
  buckets: readonly number[],
): MetricEntry[] {
  const bucket = (le: string): MetricEntry => ({
    name: `${family}_bucket`,
    labels: { ...labels, le },
    value: 1,
  })
  return [
    ...buckets.filter((b) => value <= b).map((b) => bucket(String(b))),
    bucket('+Inf'),
    { name: `${family}_sum`, labels, value },
    { name: `${family}_count`, labels, value: 1 },
  ]
}

// One TraceItem -> the cpu + wall histogram deltas sharing one label set. Items with a
// null event (the runtime occasionally emits trace-only items with no event info) carry
// no route to attribute and are dropped — there is nothing to measure.
export function deltasForItem(item: TraceItem): MetricEntry[] {
  if (item.event === null) return []
  const labels = labelsFor(attribute(item.event), item.outcome)
  return [
    ...histogramDeltas(CPU_METRIC, labels, item.cpuTime, CPU_BUCKETS_MS),
    ...histogramDeltas(WALL_METRIC, labels, item.wallTime, WALL_BUCKETS_MS),
  ]
}
