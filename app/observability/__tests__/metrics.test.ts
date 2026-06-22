import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  drainPending,
  emit,
  formatPrometheus,
  metricKey,
  remergePending,
  resetCountersForTesting,
  snapshotCountersForTesting,
  type MetricEntry,
  type MetricLabels,
} from '~/observability/metrics'

// [LAW:behavior-not-structure] These tests assert the CONTRACT the homelab
// puller depends on: the log prefix, the message-arg shape, and the typed-
// label discipline. They do NOT assert how emit is implemented — the day we
// move to a queue or a direct push, the contract changes once and these tests
// flag it loudly.

describe('emit', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    logSpy.mockRestore()
    resetCountersForTesting()
  })

  it('emits a [metric] prefixed log with labels + value', () => {
    emit('slopspot.firehose.fire', { channel: 'firehose-default', outcome: 'fired' }, 1)
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls[0]?.[0]).toBe('[metric] slopspot.firehose.fire')
    expect(logSpy.mock.calls[0]?.[1]).toEqual({
      channel: 'firehose-default',
      outcome: 'fired',
      value: 1,
    })
  })

  it('shapes each metric per its declared LabelSet (compile-time check)', () => {
    // [LAW:types-are-the-program] If any of these calls compiles with the wrong
    // shape, the type definition is too loose. If a future metric is added to
    // MetricLabels but this test isn't updated, that is fine — the test is a
    // sample, not exhaustive. The compile check is the real verifier: a typo
    // here would fail tsc -b before the test runner sees it.
    emit('slopspot.firehose.fire', { channel: 'c', outcome: 'fired' }, 1)
    emit('slopspot.write.batch_outcome', { content_kind: 'generation', outcome: 'success' }, 1)
    emit('slopspot.write.orphan_detected', { content_kind: 'generation' }, 1)
    emit(
      'slopspot.post.created',
      { content_kind: 'found', provider_id: 'fal-flux-mock', style_family: 'photoreal' },
      1,
    )
    emit(
      'slopspot.provider.generate_duration_ms',
      { provider_id: 'fal-flux-mock', outcome: 'success' },
      1234,
    )
    emit('slopspot.provider.cost_usd', { provider_id: 'fal-flux' }, 0.003)
    expect(logSpy).toHaveBeenCalledTimes(6)
  })

  it('keeps value as a numeric field on the labels object', () => {
    emit('slopspot.provider.cost_usd', { provider_id: 'replicate-sdxl' }, 0.0035)
    const arg = logSpy.mock.calls[0]?.[1] as { provider_id: string; value: number }
    expect(typeof arg.value).toBe('number')
    expect(arg.value).toBe(0.0035)
  })

  it('accumulates repeated emissions for the same metric+labels', () => {
    emit('slopspot.http.request', { route: 'home', status: '200' }, 1)
    emit('slopspot.http.request', { route: 'home', status: '200' }, 1)
    emit('slopspot.http.request', { route: 'home', status: '200' }, 1)
    const snap = snapshotCountersForTesting()
    const entry = [...snap.values()].find(
      (e) => e.name === 'slopspot.http.request' &&
        (e.labels as Record<string, string>).route === 'home',
    )
    expect(entry?.value).toBe(3)
  })

  it('keeps distinct label combinations as separate counter entries', () => {
    emit('slopspot.http.request', { route: 'home', status: '200' }, 1)
    emit('slopspot.http.request', { route: 'p.$id', status: '200' }, 1)
    emit('slopspot.http.request', { route: 'home', status: '404' }, 1)
    const snap = snapshotCountersForTesting()
    expect(snap.size).toBe(3)
  })
})

// [LAW:behavior-not-structure] The scrape-format contract the home-infra puller depends on.
// formatPrometheus is pure — it takes counter entries (the durable view fed by the /metrics
// route) and renders Prometheus text — so these assert the FORMAT without any storage or
// buffer coupling.
describe('formatPrometheus', () => {
  it('returns empty string when there are no entries', () => {
    expect(formatPrometheus([])).toBe('')
  })

  it('converts dots in metric names to underscores', () => {
    const output = formatPrometheus([
      { name: 'slopspot.http.request', labels: { route: 'home', status: '200' }, value: 5 },
    ])
    expect(output).toContain('slopspot_http_request{')
    expect(output).not.toContain('slopspot.http.request')
  })

  it('includes label key=value pairs and the counter value', () => {
    const output = formatPrometheus([
      { name: 'slopspot.http.request', labels: { route: 'home', status: '200' }, value: 42 },
    ])
    expect(output).toContain('route="home"')
    expect(output).toContain('status="200"')
    expect(output).toContain('} 42')
  })

  it('escapes double quotes in label values', () => {
    const output = formatPrometheus([
      { name: 'slopspot.http.request', labels: { route: 'tricky"route', status: '200' }, value: 1 },
    ])
    expect(output).toContain('route="tricky\\"route"')
  })

  it('renders one line per entry', () => {
    const output = formatPrometheus([
      { name: 'slopspot.http.request', labels: { route: 'home', status: '200' }, value: 1 },
      { name: 'slopspot.http.request', labels: { route: 'home', status: '404' }, value: 2 },
    ])
    expect(output.split('\n')).toHaveLength(2)
  })
})

// The delta buffer's drain/re-merge contract — the half of the durable-flush mechanism that
// lives in this module (the D1 half is app/db/__tests__/metric-counters.test.ts). [LAW:no-silent-failure]
describe('drainPending / remergePending', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    logSpy.mockRestore()
    resetCountersForTesting()
  })

  it('drains accumulated deltas and empties the buffer (each delta leaves exactly once)', () => {
    emit('slopspot.http.request', { route: 'home', status: '200' }, 1)
    emit('slopspot.http.request', { route: 'home', status: '200' }, 1)
    emit('slopspot.firehose.fire', { channel: 'c', outcome: 'fired' }, 1)

    const drained = drainPending()
    const byKey = new Map(drained.map((e) => [metricKey(e.name, e.labels), e.value]))
    expect(byKey.get(metricKey('slopspot.http.request', { route: 'home', status: '200' }))).toBe(2)
    expect(byKey.get(metricKey('slopspot.firehose.fire', { channel: 'c', outcome: 'fired' }))).toBe(1)

    // Buffer is empty after a drain — a second drain yields nothing.
    expect(drainPending()).toEqual([])
  })

  it('re-merges returned deltas additively with deltas that arrived after the drain', () => {
    emit('slopspot.http.request', { route: 'home', status: '200' }, 3)
    const drained = drainPending()

    // A new emit lands in the (now empty) buffer while the "flush" was in flight.
    emit('slopspot.http.request', { route: 'home', status: '200' }, 4)
    // The flush failed, so the drained deltas come back — they must ADD, not overwrite.
    remergePending(drained)

    const snap = snapshotCountersForTesting()
    const entry = [...snap.values()].find((e) => e.name === 'slopspot.http.request')
    expect(entry?.value).toBe(7)
  })

  it('round-trips a re-merged delta into a value identical to a fresh emit', () => {
    const entries: MetricEntry[] = [
      { name: 'slopspot.provider.cost_usd', labels: { provider_id: 'fal-flux' }, value: 0.003 },
    ]
    remergePending(entries)
    const snap = snapshotCountersForTesting()
    expect([...snap.values()][0]?.value).toBe(0.003)
  })
})

// Compile-time only — never executed. If a future edit to MetricLabels makes any
// of these illegal (or makes an *illegal* shape legal), tsc -b fails. Keeps the
// type-level contract honest without bloating the runtime tests.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _typecheckLabelShapes(): void {
  const fire: MetricLabels['slopspot.firehose.fire'] = {
    channel: 'x',
    outcome: 'fired',
  }
  // @ts-expect-error — outcome is a closed union; 'maybe' is not in it
  const badFire: MetricLabels['slopspot.firehose.fire'] = { channel: 'x', outcome: 'maybe' }
  // @ts-expect-error — channel is required
  const missingChannel: MetricLabels['slopspot.firehose.fire'] = { outcome: 'fired' }
  void fire
  void badFire
  void missingChannel
}
