import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// [LAW:behavior-not-structure] These tests assert the scheduled handler's
// contract: over-budget short-circuits before any post is created; within-
// budget fires runGeneratorPass once per channel; failure surfaces via
// console.error but doesn't crash the worker. They do not assert *how*
// runGeneratorPass composes persona/chooser/createPost — that is
// runGeneratorPass's own contract, tested in generator.ts unit tests.
// The observable outcomes here are metric emissions and per-channel call counts.

const checkBudgetMock = vi.fn()
const runGeneratorPassMock = vi.fn()
const emitMock = vi.fn()

vi.mock('~/firehose/budget', () => ({
  checkBudget: (...args: unknown[]) => checkBudgetMock(...args),
}))
vi.mock('~/agents/generator', () => ({
  runGeneratorPass: (...args: unknown[]) => runGeneratorPassMock(...args),
}))
vi.mock('~/observability/metrics', () => ({
  emit: (...args: unknown[]) => emitMock(...args),
}))

const fakeEnv = {} as Env
const MIN = 60_000

// First SCHEDULES entry is (channel='generation-a', period=47, offset=0); any
// integer multiple of (47*MIN) is a channel-a alignment minute. Tests that
// want a single channel-a fire use channelAMinute(k); tests that want any
// firing tick use channelAMinute(0).
function channelAMinute(k: number): number {
  return k * 47 * MIN
}

// A minute that is not aligned with any SCHEDULES entry — chooseFires returns
// [] and runScheduled is a complete no-op. Used to assert the no-fire branch.
// (offset=0,17,41 / period=47,53,73 — minute 1 is aligned with none of them
// because 1 % 47 ≠ 0, (1-17) % 53 ≠ 0, (1-41) % 73 ≠ 0.)
const NO_FIRE_MINUTE = 1 * MIN

function fakeEvent(scheduledTime: number): ScheduledController {
  return { scheduledTime, cron: '* * * * *', noRetry: () => {} } as ScheduledController
}

describe('runScheduled', () => {
  // [LAW:behavior-not-structure] Import once in beforeAll — the dynamic-import
  // pattern was causing the first-test timeout because vitest's module resolver
  // takes >5s on cold load for this module's dependency graph. Cached from
  // beforeAll, every test uses the same instance without re-resolving.
  let runScheduled: Awaited<typeof import('./scheduled')>['runScheduled']
  beforeAll(async () => {
    runScheduled = (await import('./scheduled')).runScheduled
  }, 30_000)

  beforeEach(() => {
    checkBudgetMock.mockReset()
    runGeneratorPassMock.mockReset()
    emitMock.mockReset()
    // Default: runGeneratorPass succeeds (creates a post without returning a value).
    runGeneratorPassMock.mockResolvedValue(undefined)
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('no-fire tick: no budget check, no post, no metric emit', async () => {
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })

    await runScheduled(fakeEvent(NO_FIRE_MINUTE), fakeEnv)

    expect(checkBudgetMock).not.toHaveBeenCalled()
    expect(runGeneratorPassMock).not.toHaveBeenCalled()
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('skips post creation when over budget — emits skipped-budget per channel', async () => {
    checkBudgetMock.mockResolvedValue({ withinBudget: false, spentUsd: 1.0, ceilingUsd: 1.0 })

    await runScheduled(fakeEvent(channelAMinute(0)), fakeEnv)

    expect(runGeneratorPassMock).not.toHaveBeenCalled()
    // Channel-a fires at minute 0 → one skipped-budget emit for that channel.
    expect(emitMock).toHaveBeenCalledWith(
      'slopspot.firehose.fire',
      { channel: 'generation-a', outcome: 'skipped-budget' },
      1,
    )
  })

  it('within-budget: calls runGeneratorPass once per firing channel, emits fired', async () => {
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })

    await runScheduled(fakeEvent(channelAMinute(1)), fakeEnv)

    // runGeneratorPass owns the persona + chooser + createPost pipeline.
    // runScheduled's contract is: one call per channel, correct env + scheduledTime.
    expect(runGeneratorPassMock).toHaveBeenCalledTimes(1)
    const [env, scheduledTime] = runGeneratorPassMock.mock.calls[0]!
    expect(env).toBe(fakeEnv)
    expect(scheduledTime).toBe(channelAMinute(1))
    expect(emitMock).toHaveBeenCalledWith(
      'slopspot.firehose.fire',
      { channel: 'generation-a', outcome: 'fired' },
      1,
    )
  })

  it('multi-channel tick: one runGeneratorPass call + one fired emit per channel', async () => {
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })

    const { SCHEDULES, chooseFires } = await import('./schedule')
    let coincidenceMinute: number | null = null
    for (let m = 1; m < 50_000; m++) {
      if (chooseFires(m * MIN, SCHEDULES).length >= 2) {
        coincidenceMinute = m
        break
      }
    }
    if (coincidenceMinute === null) {
      throw new Error('no pairwise coincidence in 50000 minutes — SCHEDULES broken')
    }
    const firingChannels = chooseFires(coincidenceMinute * MIN, SCHEDULES)

    await runScheduled(fakeEvent(coincidenceMinute * MIN), fakeEnv)

    expect(runGeneratorPassMock).toHaveBeenCalledTimes(firingChannels.length)
    const firedEmits = emitMock.mock.calls.filter(
      (call) =>
        call[0] === 'slopspot.firehose.fire' &&
        (call[1] as { outcome: string }).outcome === 'fired',
    )
    expect(firedEmits.length).toBe(firingChannels.length)
    const firedChannels = firedEmits.map((c) => (c[1] as { channel: string }).channel)
    expect(firedChannels).toEqual(firingChannels)
  })

  it('does not throw when runGeneratorPass rejects — keeps the worker alive, emits skipped-error', async () => {
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    runGeneratorPassMock.mockRejectedValue(new Error('upstream provider failed'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(runScheduled(fakeEvent(channelAMinute(2)), fakeEnv)).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
    // The error log carries channel + scheduledTime for locatability.
    const call = errSpy.mock.calls[0]!
    expect(call[0]).toBe('firehose.scheduled: fire failed')
    expect(call[1]).toEqual({ channel: 'generation-a', scheduledTime: channelAMinute(2) })
    expect(emitMock).toHaveBeenCalledWith(
      'slopspot.firehose.fire',
      { channel: 'generation-a', outcome: 'skipped-error' },
      1,
    )
  })

  it('passes scheduledTime and env to runGeneratorPass on each channel fire', async () => {
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })

    const t = channelAMinute(5)
    await runScheduled(fakeEvent(t), fakeEnv)

    expect(runGeneratorPassMock).toHaveBeenCalledWith(fakeEnv, t)
  })
})
