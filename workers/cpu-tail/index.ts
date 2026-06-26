// slopspot-cpu-tail — the out-of-band CPU-measurement tail consumer.
//
// Cloudflare delivers every slopspot-web invocation's finalized trace (with the true
// billed cpuTime, which the handler itself CANNOT read) to this Worker's `tail` handler.
// We map each TraceItem to slopspot_request_cpu_ms / slopspot_request_wall_ms and push
// one batch to VictoriaMetrics over the proven :8428/write InfluxDB-line endpoint.
//
// [LAW:single-enforcer] This Worker is the one place per-request CPU is observed; the
// app's emit() pipeline stays the single enforcer for app-domain metrics. No overlap.

import { nowNs, pushLines, toInfluxLine } from './push'
import { samplesForItem } from './sample'

type TailEnv = {
  // The full public InfluxDB-line write URL: https://vm-ingest.sanctuary.gdn/write
  // (the Cloudflare-Tunnel ingress fronting VM). A `var` in wrangler.jsonc.
  VICTORIA_METRICS_ENDPOINT: string
  // [LAW:single-enforcer] The Cloudflare Access service-token pair — WORKER SECRETS
  // (`wrangler secret put`), NOT vars. Cloudflare Access validates these at the edge
  // BEFORE the request enters the tunnel; VM itself stays internally auth-less. This
  // is the one authentication enforcer on the public write boundary.
  CF_ACCESS_CLIENT_ID: string
  CF_ACCESS_CLIENT_SECRET: string
}

export default {
  async tail(events: TraceItem[], env: TailEnv): Promise<void> {
    const ts = nowNs()
    const lines = events
      .flatMap((item) => samplesForItem(item, ts))
      .map(toInfluxLine)
    // An all-event-null / empty batch yields no lines; pushing an empty body would be a
    // wasted subrequest, so the dataflow naturally short-circuits on the empty list.
    if (lines.length === 0) return
    await pushLines(env.VICTORIA_METRICS_ENDPOINT, lines, {
      'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
    })
  },
} satisfies ExportedHandler<TailEnv>
