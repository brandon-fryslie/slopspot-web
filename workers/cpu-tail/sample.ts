// TraceItem -> metric samples. Pure; the worker entry (index.ts) does only I/O.
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

import { canonicalizeRoute } from '../../app/lib/route-canonicalize'
import { ROUTE_PATTERNS } from '../../app/lib/route-patterns.generated'
import type { LineSample } from './push'

export const CPU_METRIC = 'slopspot_request_cpu_ms' as const
export const WALL_METRIC = 'slopspot_request_wall_ms' as const

// The closed set of handler classes the metric distinguishes. [LAW:types-are-the-program]
// `assertNever` over this union (in samplesForItem) makes adding a Handler value without
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

// One TraceItem -> two samples (cpu + wall) sharing labels. Items with a null event
// (the runtime occasionally emits trace-only items with no event info) carry no route
// to attribute and are dropped — there is nothing to measure.
export function samplesForItem(item: TraceItem, timestampNs: string): LineSample[] {
  if (item.event === null) return []
  const labels = labelsFor(attribute(item.event), item.outcome)
  return [
    { name: CPU_METRIC, labels, value: item.cpuTime, timestampNs },
    { name: WALL_METRIC, labels, value: item.wallTime, timestampNs },
  ]
}
