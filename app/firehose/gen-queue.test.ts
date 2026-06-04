import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenJob } from './gen-queue'

// [LAW:behavior-not-structure] runGenJobs is the generation consumer. Its
// contract: per message, gate on budget then fire runGeneratorPass; emit the
// per-channel fire metric (fired | skipped-budget | skipped-error); ack every
// message regardless of outcome (generation is non-idempotent — never replay).
// The load-bearing subtlety is ANTI-REP: messages are processed sequentially so
// job B's pass runs only after job A's pass resolves (max_concurrency:1 extends
// this across batches). These tests assert those observable outcomes, not how
// runGeneratorPass composes a slop (that is its own contract).

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

type AckedMessage = { body: GenJob; ack: ReturnType<typeof vi.fn> }

// Build a MessageBatch with a spyable ack() per message so tests can assert the
// ack-every-message invariant. Only the fields runGenJobs reads are populated.
function makeBatch(jobs: GenJob[]): { batch: MessageBatch<GenJob>; messages: AckedMessage[] } {
  const messages: AckedMessage[] = jobs.map((body) => ({ body, ack: vi.fn() }))
  const batch = {
    queue: 'slopspot-gen',
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<GenJob>
  return { batch, messages }
}

const jobA: GenJob = { channel: 'generation-a', scheduledTimeMs: 47 * 60_000 }
const jobB: GenJob = { channel: 'generation-b', scheduledTimeMs: 53 * 60_000 }
const jobC: GenJob = { channel: 'generation-c', scheduledTimeMs: 73 * 60_000 }

describe('runGenJobs (consumer)', () => {
  let runGenJobs: Awaited<typeof import('./gen-queue')>['runGenJobs']
  beforeAll(async () => {
    runGenJobs = (await import('./gen-queue')).runGenJobs
  }, 30_000)

  beforeEach(() => {
    checkBudgetMock.mockReset()
    runGeneratorPassMock.mockReset()
    emitMock.mockReset()
    runGeneratorPassMock.mockResolvedValue(undefined)
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('within budget: fires runGeneratorPass with the job seed, emits fired, acks', async () => {
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    const { batch, messages } = makeBatch([jobA])

    await runGenJobs(batch, fakeEnv)

    expect(runGeneratorPassMock).toHaveBeenCalledTimes(1)
    expect(runGeneratorPassMock).toHaveBeenCalledWith(fakeEnv, jobA.scheduledTimeMs)
    expect(emitMock).toHaveBeenCalledWith(
      'slopspot.firehose.fire',
      { channel: 'generation-a', outcome: 'fired' },
      1,
    )
    expect(messages[0]!.ack).toHaveBeenCalledTimes(1)
  })

  it('over budget: skips the fire, emits skipped-budget, still acks', async () => {
    checkBudgetMock.mockResolvedValue({ withinBudget: false, spentUsd: 1.0, ceilingUsd: 1.0 })
    const { batch, messages } = makeBatch([jobA])

    await runGenJobs(batch, fakeEnv)

    expect(runGeneratorPassMock).not.toHaveBeenCalled()
    expect(emitMock).toHaveBeenCalledWith(
      'slopspot.firehose.fire',
      { channel: 'generation-a', outcome: 'skipped-budget' },
      1,
    )
    expect(messages[0]!.ack).toHaveBeenCalledTimes(1)
  })

  it('fire failure: does not throw, emits skipped-error + logs, still acks', async () => {
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    runGeneratorPassMock.mockRejectedValue(new Error('upstream provider failed'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { batch, messages } = makeBatch([jobA])

    await expect(runGenJobs(batch, fakeEnv)).resolves.toBeUndefined()

    expect(errSpy).toHaveBeenCalled()
    const call = errSpy.mock.calls[0]!
    expect(call[0]).toBe('firehose.gen-queue: fire failed')
    expect(call[1]).toEqual({ channel: 'generation-a', scheduledTime: jobA.scheduledTimeMs })
    expect(emitMock).toHaveBeenCalledWith(
      'slopspot.firehose.fire',
      { channel: 'generation-a', outcome: 'skipped-error' },
      1,
    )
    expect(messages[0]!.ack).toHaveBeenCalledTimes(1)
  })

  it('batch: processes every message in order and acks each', async () => {
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    const { batch, messages } = makeBatch([jobA, jobB])

    await runGenJobs(batch, fakeEnv)

    expect(runGeneratorPassMock).toHaveBeenCalledTimes(2)
    expect(messages[0]!.ack).toHaveBeenCalledTimes(1)
    expect(messages[1]!.ack).toHaveBeenCalledTimes(1)
    const firedChannels = emitMock.mock.calls
      .filter((c) => (c[1] as { outcome: string }).outcome === 'fired')
      .map((c) => (c[1] as { channel: string }).channel)
    expect(firedChannels).toEqual(['generation-a', 'generation-b'])
  })

  // [LAW:dataflow-not-control-flow] The anti-rep invariant: job B's pass must not
  // start until job A's pass resolves (read-after-write — B's getRecentRecipes
  // sees A's committed recipe). Prove it by gating A on a deferred promise and
  // asserting B has NOT been invoked while A is still in flight.
  it('serializes: job B does not fire until job A resolves', async () => {
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 })
    let releaseA!: () => void
    const aGate = new Promise<void>((resolve) => {
      releaseA = resolve
    })
    runGeneratorPassMock
      .mockImplementationOnce(async () => {
        await aGate
      })
      .mockResolvedValueOnce(undefined)

    const { batch } = makeBatch([jobA, jobB])
    const done = runGenJobs(batch, fakeEnv)

    // Let microtasks flush: A is awaiting aGate, B must not have started.
    await Promise.resolve()
    expect(runGeneratorPassMock).toHaveBeenCalledTimes(1)
    expect(runGeneratorPassMock).toHaveBeenLastCalledWith(fakeEnv, jobA.scheduledTimeMs)

    releaseA()
    await done
    expect(runGeneratorPassMock).toHaveBeenCalledTimes(2)
  })

  // [LAW:no-silent-fallbacks] The teeth: checkBudget does a live D1 query that can
  // throw (transient 503). A budget-query failure on ONE job must NOT abort the
  // batch and silently drop its mates under max_retries:0 — it must be SIGNALLED
  // (skipped-error) and the loop must continue + ack every message. This test
  // FAILS against the pre-fix code (checkBudget outside the try → runOneJob throws
  // → runGenJobs aborts mid-loop → jobC unacked+unfired, no skipped-error emit).
  it('checkBudget throws on job B: does not abort batch — signals skipped-error, fires A+C, acks all', async () => {
    checkBudgetMock
      .mockResolvedValueOnce({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 }) // A
      .mockRejectedValueOnce(new Error('D1_ERROR: transient 503')) // B
      .mockResolvedValueOnce({ withinBudget: true, spentUsd: 0, ceilingUsd: 1.0 }) // C
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { batch, messages } = makeBatch([jobA, jobB, jobC])

    // The whole batch resolves — a mid-batch budget-query failure never throws out.
    await expect(runGenJobs(batch, fakeEnv)).resolves.toBeUndefined()

    // A and C fired (by their distinct seeds); B did not.
    expect(runGeneratorPassMock).toHaveBeenCalledTimes(2)
    expect(runGeneratorPassMock).toHaveBeenCalledWith(fakeEnv, jobA.scheduledTimeMs)
    expect(runGeneratorPassMock).toHaveBeenCalledWith(fakeEnv, jobC.scheduledTimeMs)
    expect(runGeneratorPassMock).not.toHaveBeenCalledWith(fakeEnv, jobB.scheduledTimeMs)

    // B's budget-query failure is SIGNALLED, not silent.
    expect(emitMock).toHaveBeenCalledWith(
      'slopspot.firehose.fire',
      { channel: 'generation-b', outcome: 'skipped-error' },
      1,
    )
    expect(errSpy).toHaveBeenCalledWith(
      'firehose.gen-queue: fire failed',
      { channel: 'generation-b', scheduledTime: jobB.scheduledTimeMs },
      expect.any(Error),
    )

    // Every message acked — none silently dropped.
    for (const message of messages) {
      expect(message.ack).toHaveBeenCalledTimes(1)
    }
  })
})
