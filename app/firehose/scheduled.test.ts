import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// [LAW:behavior-not-structure] These tests assert the scheduled handler's
// contract: over-budget short-circuits before any post is created; within-
// budget produces exactly one post via createPost with the firehose attribution.
// They do not assert *how* the handler composes those calls — only the
// observable outcomes a future refactor must preserve.

const checkBudgetMock = vi.fn()
const createPostMock = vi.fn()

vi.mock('~/firehose/budget', () => ({
  checkBudget: (...args: unknown[]) => checkBudgetMock(...args),
}))
vi.mock('~/db/posts', () => ({
  createPost: (...args: unknown[]) => createPostMock(...args),
}))

const fakeEnv = {} as Env

function fakeEvent(scheduledTime: number): ScheduledController {
  return { scheduledTime, cron: '0 */6 * * *', noRetry: () => {} } as ScheduledController
}

describe('runScheduled', () => {
  beforeEach(() => {
    checkBudgetMock.mockReset()
    createPostMock.mockReset()
    // The handler logs success/skip lines for production observability; we
    // silence them in tests so the test runner output stays focused on
    // assertion failures. Tests that need to assert on logs reinstate the
    // spy locally.
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

  it('creates one post via fal-flux attributed to sys:slop-cron when within budget', async () => {
    const { runScheduled } = await import('./scheduled')
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    createPostMock.mockResolvedValue({ id: 'post-test-1' })

    await runScheduled(fakeEvent(Date.UTC(2026, 5, 17, 0, 0, 0)), fakeEnv)

    expect(createPostMock).toHaveBeenCalledTimes(1)
    const [input, ctx] = createPostMock.mock.calls[0]!
    expect(input.providerId).toBe('fal-flux')
    expect(input.params.aspectRatio).toBe('1:1')
    expect(input.params.steps).toBe(4)
    expect(typeof input.params.prompt).toBe('string')
    expect(input.params.prompt.length).toBeGreaterThan(0)
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

  it('passes the event scheduledTime through pickPrompt: different ticks → potentially different prompts', async () => {
    const { runScheduled } = await import('./scheduled')
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    createPostMock.mockResolvedValue({ id: 'post-test-1' })

    // Two arbitrary scheduledTimes; the handler should derive the prompt from
    // each, not from a constant. We sample many enough to see at least one
    // pair differ, proving the handler is actually consulting scheduledTime.
    const prompts = new Set<string>()
    for (let i = 0; i < 50; i++) {
      createPostMock.mockClear()
      await runScheduled(fakeEvent(i * 60_000), fakeEnv)
      prompts.add(createPostMock.mock.calls[0]![0].params.prompt)
    }
    expect(prompts.size).toBeGreaterThan(1)
  })
})
