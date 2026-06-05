// [LAW:single-enforcer] The one place in-process counters exit into the scrape world.
// formatPrometheusMetrics() is the single formatter — this route calls it and returns
// the result. No reformatting, no second accumulator, no parallel path.
//
// NOTE: This endpoint returns PER-ISOLATE counters. Cloudflare Workers may run multiple
// isolates simultaneously across edge PoPs; each isolate accumulates its own slice of
// traffic. The homelab scraper will observe one isolate's data per scrape — appropriate
// for rate/trend signals on a low-traffic service, not a globally aggregated fleet view.
// The batch-log path (console.log → puller → VM) remains the authoritative global record;
// this endpoint adds real-time visibility into the active serving isolate.

import type { Route } from './+types/metrics'
import { formatPrometheusMetrics } from '~/observability/metrics'

export async function loader(_: Route.LoaderArgs) {
  return new Response(formatPrometheusMetrics(), {
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
  })
}
