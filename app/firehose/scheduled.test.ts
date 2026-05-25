import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// [LAW:behavior-not-structure] These tests assert the scheduled handler's
// contract: over-budget short-circuits before any post is created; within-
// budget produces exactly one post via createPost; provider/styleFamily/
// aspectRatio/subjectTemplate are driven by the chooser (not hardcoded);
// failure surfaces via console.error but doesn't crash the worker. They do
// not assert *how* the handler composes those calls — only the observable
// outcomes a future refactor must preserve.

const checkBudgetMock = vi.fn()
const createPostMock = vi.fn()
const getRecentRecipesMock = vi.fn()

vi.mock('~/firehose/budget', () => ({
  checkBudget: (...args: unknown[]) => checkBudgetMock(...args),
}))
vi.mock('~/db/posts', () => ({
  createPost: (...args: unknown[]) => createPostMock(...args),
}))
vi.mock('~/db/recent', () => ({
  getRecentRecipes: (...args: unknown[]) => getRecentRecipesMock(...args),
}))

const fakeEnv = {} as Env

function fakeEvent(scheduledTime: number): ScheduledController {
  return { scheduledTime, cron: '0 */6 * * *', noRetry: () => {} } as ScheduledController
}

describe('runScheduled', () => {
  beforeEach(() => {
    checkBudgetMock.mockReset()
    createPostMock.mockReset()
    getRecentRecipesMock.mockReset()
    // Default: no anti-rep history (chooser samples freely).
    getRecentRecipesMock.mockResolvedValue([])
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('skips post creation when over budget', async () => {
    const { runScheduled } = await import('./scheduled')
    checkBudgetMock.mockResolvedValue({ withinBudget: false, spentUsd: 1.0, ceilingUsd: 1.0 })

    await runScheduled(fakeEvent(0), fakeEnv)

    expect(createPostMock).not.toHaveBeenCalled()
  })

  it('within-budget: creates one post via a real provider, attributed to sys:slop-cron', async () => {
    const { runScheduled } = await import('./scheduled')
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    createPostMock.mockResolvedValue({ id: 'post-test-1' })

    await runScheduled(fakeEvent(Date.UTC(2026, 5, 17, 0, 0, 0)), fakeEnv)

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
  })

  it('does not throw when createPost rejects — keeps the worker alive', async () => {
    const { runScheduled } = await import('./scheduled')
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    createPostMock.mockRejectedValue(new Error('upstream provider failed'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(runScheduled(fakeEvent(0), fakeEnv)).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
  })

  it('does not throw when getRecentRecipes rejects — logs select-phase failure and keeps the worker alive', async () => {
    const { runScheduled } = await import('./scheduled')
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    getRecentRecipesMock.mockRejectedValue(new Error('D1 read failed'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(runScheduled(fakeEvent(0), fakeEnv)).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
    // Select-phase failure → createPost is never reached.
    expect(createPostMock).not.toHaveBeenCalled()
    // The structured log carries scheduledTime so the failed fire is locatable.
    const call = errSpy.mock.calls[0]!
    expect(call[0]).toBe('firehose.scheduled: recipe selection failed')
    expect(call[1]).toEqual({ scheduledTime: 0 })
  })

  it('drives provider selection from the chooser — providers vary across fires', async () => {
    const { runScheduled } = await import('./scheduled')
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    createPostMock.mockResolvedValue({ id: 'post-test-1' })

    const providersSeen = new Set<string>()
    for (let i = 0; i < 100; i++) {
      createPostMock.mockClear()
      await runScheduled(fakeEvent(i * 60_000), fakeEnv)
      providersSeen.add(createPostMock.mock.calls[0]![0].providerId)
    }
    // Across 100 fires the chooser should land on more than one provider —
    // pre-pl6.5 this set was always {'fal-flux'}.
    expect(providersSeen.size).toBeGreaterThan(1)
  })

  it('passes the event scheduledTime through chooseNextGeneration: different ticks → potentially different prompts', async () => {
    const { runScheduled } = await import('./scheduled')
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    createPostMock.mockResolvedValue({ id: 'post-test-1' })

    const prompts = new Set<string>()
    for (let i = 0; i < 50; i++) {
      createPostMock.mockClear()
      await runScheduled(fakeEvent(i * 60_000), fakeEnv)
      prompts.add(createPostMock.mock.calls[0]![0].params.prompt)
    }
    expect(prompts.size).toBeGreaterThan(1)
  })

  it('passes the RECENT_WINDOW to getRecentRecipes', async () => {
    const { runScheduled } = await import('./scheduled')
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    createPostMock.mockResolvedValue({ id: 'post-test-1' })

    await runScheduled(fakeEvent(0), fakeEnv)

    expect(getRecentRecipesMock).toHaveBeenCalledTimes(1)
    const [env, n] = getRecentRecipesMock.mock.calls[0]!
    expect(env).toBe(fakeEnv)
    // Window size is the R5/R6 design-doc value of 20.
    expect(n).toBe(20)
  })
})
