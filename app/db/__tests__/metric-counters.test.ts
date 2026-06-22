import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyDeltas,
  flushMetrics,
  readDurableCounters,
} from '~/db/metric-counters'
import { emit, resetCountersForTesting } from '~/observability/metrics'

// [LAW:verifiable-goals] The gtz fix made machine-checkable: counter state has ONE durable
// owner (the metric_counters table), so the /metrics read is COMPLETE (every isolate flushes
// here) and MONOTONIC (value = value + delta). These run against real miniflare D1 with the
// drizzle/ migrations applied, so the schema is byte-identical to prod.
//
// The in-process delta buffer is module state that persists across tests in this file's
// isolate; reset it each test so one test's emits don't leak into the next. (D1 writes are
// rolled back per test by isolatedStorage.)
describe('metric-counters durable store', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    resetCountersForTesting()
  })

  afterEach(() => {
    logSpy.mockRestore()
    resetCountersForTesting()
  })

  it('round-trips name, labels, and value through D1', async () => {
    await applyDeltas(env, [
      { name: 'slopspot.provider.cost_usd', labels: { provider_id: 'fal-flux' }, value: 0.003 },
    ])
    const read = await readDurableCounters(env)
    expect(read).toContainEqual({
      name: 'slopspot.provider.cost_usd',
      labels: { provider_id: 'fal-flux' },
      value: 0.003,
    })
  })

  it('ACCUMULATES across separate flushes (monotonic — the core fix)', async () => {
    // Two applyDeltas calls stand in for two isolates flushing the same (name, labels).
    await applyDeltas(env, [
      { name: 'slopspot.http.request', labels: { route: 'home', status: '200' }, value: 2 },
    ])
    await applyDeltas(env, [
      { name: 'slopspot.http.request', labels: { route: 'home', status: '200' }, value: 3 },
    ])
    const read = await readDurableCounters(env)
    const entry = read.find((e) => e.name === 'slopspot.http.request')
    expect(entry?.value).toBe(5)
  })

  it('keeps distinct label combinations as distinct rows', async () => {
    await applyDeltas(env, [
      { name: 'slopspot.http.request', labels: { route: 'home', status: '200' }, value: 1 },
      { name: 'slopspot.http.request', labels: { route: 'home', status: '404' }, value: 1 },
    ])
    const read = await readDurableCounters(env)
    expect(read.filter((e) => e.name === 'slopspot.http.request')).toHaveLength(2)
  })

  it('reports no failures on a clean batch, and no-ops on an empty batch', async () => {
    expect(await applyDeltas(env, [])).toEqual({ failed: [] })
    const { failed } = await applyDeltas(env, [
      { name: 'slopspot.provider.cost_usd', labels: { provider_id: 'x' }, value: 1 },
    ])
    expect(failed).toEqual([])
  })

  it('flushMetrics drains the buffer so a cron/queue-emitted metric becomes durable', async () => {
    // These are exactly the metrics the ticket proved returned ZERO series: emitted in a
    // scheduled/queue isolate whose buffer the scrape never saw.
    emit('slopspot.post.created', {
      content_kind: 'generation',
      provider_id: 'fal-flux',
      style_family: 'photoreal',
    }, 1)
    emit('slopspot.firehose.fire', { channel: 'firehose-default', outcome: 'fired' }, 1)

    await flushMetrics(env)

    const read = await readDurableCounters(env)
    expect(read.find((e) => e.name === 'slopspot.post.created')?.value).toBe(1)
    expect(read.find((e) => e.name === 'slopspot.firehose.fire')?.value).toBe(1)

    // The buffer is drained — a second flush with no new emits writes nothing more.
    await flushMetrics(env)
    const reread = await readDurableCounters(env)
    expect(reread.find((e) => e.name === 'slopspot.post.created')?.value).toBe(1)
  })

  it('flushMetrics on an empty buffer is a no-op (no throw, no rows)', async () => {
    await flushMetrics(env)
    expect(await readDurableCounters(env)).toEqual([])
  })
})
