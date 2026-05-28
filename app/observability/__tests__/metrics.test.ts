import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emit, type MetricLabels } from '~/observability/metrics'

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
