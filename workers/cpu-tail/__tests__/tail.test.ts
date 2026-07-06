// Integration: the REAL tail handler against REAL miniflare D1 with the drizzle/
// migrations applied — the schema is byte-identical to prod's. [LAW:verifiable-goals]
// This is the machine-checkable core of a5w.5.1: a TraceItem batch delivered to the
// tail handler lands monotonic histogram counters in metric_counters, and the same
// formatPrometheus the /metrics route uses renders them as scrapeable series.

import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import handler from '../index'
import { readDurableCounters } from '~/db/metric-counters'
import { formatPrometheus, type MetricEntry } from '~/observability/metrics'

const fetchItem = (url: string, cpu: number, wall: number, outcome = 'ok') =>
  ({
    event: { request: { url } },
    cpuTime: cpu,
    wallTime: wall,
    outcome,
  }) as unknown as TraceItem

const find = (entries: MetricEntry[], name: string, le?: string) =>
  entries.find((e) => e.name === name && (le === undefined || e.labels.le === le))

describe('cpu-tail tail handler → durable metric_counters', () => {
  it('applies a trace batch as histogram deltas and accumulates monotonically', async () => {
    const batch = [
      fetchItem('https://slopspot.ai/p/abc', 3, 40),
      fetchItem('https://slopspot.ai/p/def', 12, 80),
    ]
    await handler.tail(batch, env)

    let entries = await readDurableCounters(env)
    expect(find(entries, 'slopspot_request_cpu_ms_count')?.value).toBe(2)
    expect(find(entries, 'slopspot_request_cpu_ms_sum')?.value).toBe(15)
    expect(find(entries, 'slopspot_request_cpu_ms_bucket', '5')?.value).toBe(1)
    expect(find(entries, 'slopspot_request_cpu_ms_bucket', '25')?.value).toBe(2)
    expect(find(entries, 'slopspot_request_cpu_ms_bucket', '+Inf')?.value).toBe(2)
    expect(find(entries, 'slopspot_request_wall_ms_count')?.value).toBe(2)
    // Route is the canonical PATTERN, never a raw id — the cardinality invariant.
    expect(find(entries, 'slopspot_request_cpu_ms_count')?.labels).toEqual({
      route: '/p/:id',
      handler: 'fetch',
      outcome: 'ok',
    })

    // A second batch ACCUMULATES (value = value + delta): the counters are monotonic.
    await handler.tail([fetchItem('https://slopspot.ai/p/ghi', 700, 900)], env)
    entries = await readDurableCounters(env)
    expect(find(entries, 'slopspot_request_cpu_ms_count')?.value).toBe(3)
    expect(find(entries, 'slopspot_request_cpu_ms_sum')?.value).toBe(715)
    // cpu=700 lands in le=1000 and +Inf but not le=25.
    expect(find(entries, 'slopspot_request_cpu_ms_bucket', '25')?.value).toBe(2)
    expect(find(entries, 'slopspot_request_cpu_ms_bucket', '+Inf')?.value).toBe(3)
  })

  it('renders as Prometheus histogram series through the same formatter /metrics uses', async () => {
    await handler.tail([fetchItem('https://slopspot.ai/p/abc', 3, 40)], env)
    const text = formatPrometheus(await readDurableCounters(env))
    expect(text).toContain(
      'slopspot_request_cpu_ms_bucket{route="/p/:id",handler="fetch",outcome="ok",le="+Inf"} 1',
    )
    expect(text).toContain(
      'slopspot_request_cpu_ms_count{route="/p/:id",handler="fetch",outcome="ok"} 1',
    )
  })

  it('does nothing on a batch with no attributable events', async () => {
    const nullEvent = { event: null, cpuTime: 0, wallTime: 0, outcome: 'ok' } as unknown as TraceItem
    await handler.tail([nullEvent], env)
    expect(await readDurableCounters(env)).toEqual([])
  })
})
