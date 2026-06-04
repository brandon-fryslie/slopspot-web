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
// once, so one write per batch keeps subrequest count low.
export async function pushLines(endpoint: string, lines: string[]): Promise<void> {
  const resp = await fetch(endpoint, {
    method: 'POST',
    body: lines.join('\n'),
    signal: AbortSignal.timeout(5_000),
  })
  if (!resp.ok) {
    console.warn('cpu-tail: push failed', { status: resp.status })
  }
}
