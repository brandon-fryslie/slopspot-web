// VictoriaMetrics push over the InfluxDB line protocol.
//
// [LAW:one-source-of-truth] This mirrors services/voter/src/metrics.ts — the proven
// working path the homelab jobs already use to push to VM :8428/write. Reproduced
// here (not imported) because the voter service is a separate Node package outside the
// pnpm workspace and the tail worker runs in workerd; the line format is the shared
// contract, asserted by unit test.

// Influx line protocol forbids unescaped spaces/commas/equals in tag values; the
// canonicalizer already bounds the value set, this is belt-and-suspenders for
// anything (cron expressions, outcome strings) that could contain them.
const escapeTag = (v: string): string => v.replace(/[, =]/g, '_')

export type LineSample = {
  name: string
  labels: Record<string, string>
  value: number
  // nanosecond timestamp; injected so the mapping is pure and unit-testable.
  timestampNs: string
}

// [LAW:types-are-the-program] One sample -> one line. The shape of a line is total
// over its inputs; there is no branch that can emit a malformed line for a valid sample.
export function toInfluxLine(sample: LineSample): string {
  const tags = Object.entries(sample.labels)
    .map(([k, v]) => `${k}=${escapeTag(v)}`)
    .join(',')
  return `${sample.name},${tags} value=${sample.value} ${sample.timestampNs}`
}

export function nowNs(): string {
  return `${Date.now()}000000`
}

// Push a batch of samples in one request — a TailEvent delivers many TraceItems at
// once, so one write per batch keeps subrequest count low. `headers` carries the
// Cloudflare Access service-token (CF-Access-Client-Id / -Secret) that authes the
// write at the tunnel edge; the endpoint is the public, Access-protected ingress.
export async function pushLines(
  endpoint: string,
  lines: string[],
  headers: Record<string, string> = {},
): Promise<void> {
  // [LAW:no-silent-fallbacks] A push failure must LOG, never throw into the tail
  // path — measurement egress can never fail the tail invocation. Both failure
  // modes are caught: an HTTP !ok response (e.g. 403 = Access rejected the token)
  // AND a transport reject (AbortSignal.timeout / DNS / network) that throws from
  // fetch itself. Either way the cpu metric won't appear and the VM-side absent()
  // rule surfaces it. Mirrors the proven services/voter/src/metrics.ts shape.
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      body: lines.join('\n'),
      headers,
      signal: AbortSignal.timeout(5_000),
    })
    if (!resp.ok) {
      console.warn('cpu-tail: push failed', { status: resp.status })
    }
  } catch (err) {
    console.warn('cpu-tail: push error', { err: String(err) })
  }
}
