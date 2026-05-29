// Push a metric to VictoriaMetrics via InfluxDB line protocol.
// Labels are key=value pairs; value is the measurement.
export async function pushMetric(
  endpoint: string,
  name: string,
  labels: Record<string, string>,
  value: number,
): Promise<void> {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}=${v.replace(/[, =]/g, '_')}`)
    .join(',')
  const line = `${name},${labelStr} value=${value} ${Date.now()}000000`
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      body: line,
      signal: AbortSignal.timeout(5_000),
    })
    if (!resp.ok) {
      console.warn('metrics: push failed', { status: resp.status })
    }
  } catch (err) {
    console.warn('metrics: push error', { err: String(err) })
  }
}
