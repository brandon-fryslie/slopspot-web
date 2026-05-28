import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// [LAW:behavior-not-structure] These tests assert the scheduled handler's
// contract: over-budget short-circuits before any post is created; within-
// budget produces one post per channel returned by chooseFires; the chooser
// drives provider / styleFamily / aspectRatio / subjectTemplate; failure
// surfaces via console.error but doesn't crash the worker. They do not assert
// *how* the handler composes those calls — only the observable outcomes a
// future refactor must preserve.

const checkBudgetMock = vi.fn()
const createPostMock = vi.fn()
const getRecentRecipesMock = vi.fn()
const emitMock = vi.fn()

vi.mock('~/firehose/budget', () => ({
  checkBudget: (...args: unknown[]) => checkBudgetMock(...args),
}))
vi.mock('~/db/posts', () => ({
  createPost: (...args: unknown[]) => createPostMock(...args),
}))
vi.mock('~/db/recent', () => ({
  getRecentRecipes: (...args: unknown[]) => getRecentRecipesMock(...args),
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
  beforeEach(() => {
    checkBudgetMock.mockReset()
    createPostMock.mockReset()
    getRecentRecipesMock.mockReset()
    emitMock.mockReset()
    // Default: no anti-rep history (chooser samples freely).
    getRecentRecipesMock.mockResolvedValue([])
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('no-fire tick: no budget check, no post, no metric emit', async () => {
    const { runScheduled } = await import('./scheduled')
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })

    await runScheduled(fakeEvent(NO_FIRE_MINUTE), fakeEnv)

    expect(checkBudgetMock).not.toHaveBeenCalled()
    expect(createPostMock).not.toHaveBeenCalled()
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('skips post creation when over budget — emits skipped-budget per channel', async () => {
    const { runScheduled } = await import('./scheduled')
    checkBudgetMock.mockResolvedValue({ withinBudget: false, spentUsd: 1.0, ceilingUsd: 1.0 })

    await runScheduled(fakeEvent(channelAMinute(0)), fakeEnv)

    expect(createPostMock).not.toHaveBeenCalled()
    // Channel-a fires at minute 0 → one skipped-budget emit for that channel.
    expect(emitMock).toHaveBeenCalledWith(
      'slopspot.firehose.fire',
      { channel: 'generation-a', outcome: 'skipped-budget' },
      1,
    )
  })

  it('within-budget: creates one post per firing channel, attributed to sys:slop-cron, emits fired', async () => {
    const { runScheduled } = await import('./scheduled')
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    createPostMock.mockResolvedValue({ id: 'post-test-1' })

    await runScheduled(fakeEvent(channelAMinute(1)), fakeEnv)

    expect(createPostMock).toHaveBeenCalledTimes(1)
    const [input, ctx] = createPostMock.mock.calls[0]!
    expect(['fal-flux', 'replicate-sdxl', 'replicate-ideogram']).toContain(input.providerId)
    expect(typeof input.params).toBe('object')
    // aspectRatio is a top-level recipe field, not in params.
    expect(input.params.aspectRatio).toBeUndefined()
    expect(typeof input.aspectRatio).toBe('string')
    expect(typeof input.styleFamily).toBe('string')
    expect(input.subject.subjectTemplate).not.toBe('T00')
    expect(input.origin).toEqual({
      actor: { kind: 'agent', agentId: 'sys:slop-cron' },
    })
    expect(ctx).toEqual({ env: fakeEnv })
    expect(emitMock).toHaveBeenCalledWith(
      'slopspot.firehose.fire',
      { channel: 'generation-a', outcome: 'fired' },
      1,
    )
  })

  it('multi-channel tick: one post + one fired emit per channel', async () => {
    const { runScheduled } = await import('./scheduled')
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    createPostMock.mockResolvedValue({ id: 'post-test-multi' })

    // channel-a (period 47, offset 0) and channel-c (period 73, offset 41)
    // jointly align when (m - 0) % 47 == 0 AND (m - 41) % 73 == 0.
    // Solve by CRT: m ≡ 0 (mod 47), m ≡ 41 (mod 73). Smallest positive m=2632.
    // (47*56=2632; (2632-41)/73=35.49 — recompute: 2632 % 73 = 2632 - 36*73 = 2632 - 2628 = 4 ≠ 41.)
    // The deterministic alignment we can name without solving CRT in the
    // test is m = LCM(47, 73) = 47*73 = 3431, shifted by the offset.
    // Easier: assert behavior using a Schedule-pair coincidence the test
    // itself constructs, with the actual SCHEDULES.
    //
    // Pragmatic approach: find the first minute in 0..LCM that hits ≥2
    // SCHEDULES entries, then use it. This couples the test to the actual
    // SCHEDULES list — desirable: if a future edit breaks pairwise
    // coincidence, this test reports it.
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

    expect(createPostMock).toHaveBeenCalledTimes(firingChannels.length)
    const firedEmits = emitMock.mock.calls.filter(
      (call) =>
        call[0] === 'slopspot.firehose.fire' &&
        (call[1] as { outcome: string }).outcome === 'fired',
    )
    expect(firedEmits.length).toBe(firingChannels.length)
    const firedChannels = firedEmits.map((c) => (c[1] as { channel: string }).channel)
    expect(firedChannels).toEqual(firingChannels)
  })

  it('does not throw when createPost rejects — keeps the worker alive, emits skipped-error', async () => {
    const { runScheduled } = await import('./scheduled')
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    createPostMock.mockRejectedValue(new Error('upstream provider failed'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(runScheduled(fakeEvent(channelAMinute(2)), fakeEnv)).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
    expect(emitMock).toHaveBeenCalledWith(
      'slopspot.firehose.fire',
      { channel: 'generation-a', outcome: 'skipped-error' },
      1,
    )
  })

  it('does not throw when getRecentRecipes rejects — logs select-phase failure with channel + scheduledTime', async () => {
    const { runScheduled } = await import('./scheduled')
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    getRecentRecipesMock.mockRejectedValue(new Error('D1 read failed'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const t = channelAMinute(3)
    await expect(runScheduled(fakeEvent(t), fakeEnv)).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
    // Select-phase failure → createPost is never reached.
    expect(createPostMock).not.toHaveBeenCalled()
    // The structured log carries scheduledTime + channel so the failed fire is locatable.
    const call = errSpy.mock.calls[0]!
    expect(call[0]).toBe('firehose.scheduled: recipe selection failed')
    expect(call[1]).toEqual({ scheduledTime: t, channel: 'generation-a' })
    expect(emitMock).toHaveBeenCalledWith(
      'slopspot.firehose.fire',
      { channel: 'generation-a', outcome: 'skipped-error' },
      1,
    )
  })

  it('drives provider selection from the chooser — providers vary across fires', async () => {
    const { runScheduled } = await import('./scheduled')
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    createPostMock.mockResolvedValue({ id: 'post-test-1' })

    const providersSeen = new Set<string>()
    for (let i = 0; i < 100; i++) {
      createPostMock.mockClear()
      await runScheduled(fakeEvent(channelAMinute(i)), fakeEnv)
      providersSeen.add(createPostMock.mock.calls[0]![0].providerId)
    }
    expect(providersSeen.size).toBeGreaterThan(1)
  })

  it('passes the event scheduledTime through chooseNextGeneration: different ticks → different prompts', async () => {
    const { runScheduled } = await import('./scheduled')
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    createPostMock.mockResolvedValue({ id: 'post-test-1' })

    const prompts = new Set<string>()
    for (let i = 0; i < 50; i++) {
      createPostMock.mockClear()
      await runScheduled(fakeEvent(channelAMinute(i)), fakeEnv)
      prompts.add(createPostMock.mock.calls[0]![0].params.prompt)
    }
    expect(prompts.size).toBeGreaterThan(1)
  })

  it('passes the RECENT_WINDOW to getRecentRecipes', async () => {
    const { runScheduled } = await import('./scheduled')
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    createPostMock.mockResolvedValue({ id: 'post-test-1' })

    await runScheduled(fakeEvent(channelAMinute(0)), fakeEnv)

    expect(getRecentRecipesMock).toHaveBeenCalledTimes(1)
    const [env, n] = getRecentRecipesMock.mock.calls[0]!
    expect(env).toBe(fakeEnv)
    // Window size is the R5/R6 design-doc value of 20.
    expect(n).toBe(20)
  })
})
