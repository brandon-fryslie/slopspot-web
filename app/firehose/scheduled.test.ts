import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenJob } from './gen-queue'

// [LAW:behavior-not-structure] runScheduled is now a PURE PRODUCER. Its whole
// contract is: chooseFires → one GEN_QUEUE.send(GenJob) per fired channel, in
// schedule order; a no-fire tick sends nothing. It must NOT touch the budget or
// the generator — those moved to the queue consumer (gen-queue.test.ts). These
// tests assert exactly that: the observable outcome is the set of enqueued jobs.

const sendMock = vi.fn()

const fakeEnv = { GEN_QUEUE: { send: (...args: unknown[]) => sendMock(...args) } } as unknown as Env
const MIN = 60_000

// First SCHEDULES entry is (channel='generation-a', period=47, offset=0); any
// integer multiple of (47*MIN) is a channel-a alignment minute.
function channelAMinute(k: number): number {
  return k * 47 * MIN
}

// A minute aligned with no SCHEDULES entry — chooseFires returns [] so the
// producer is a complete no-op (offset=0,17,41 / period=47,53,73; minute 1
// aligns with none: 1 % 47 ≠ 0, (1-17) % 53 ≠ 0, (1-41) % 73 ≠ 0).
const NO_FIRE_MINUTE = 1 * MIN

function fakeEvent(scheduledTime: number): ScheduledController {
  return { scheduledTime, cron: '* * * * *', noRetry: () => {} } as ScheduledController
}

describe('runScheduled (producer)', () => {
  let runScheduled: Awaited<typeof import('./scheduled')>['runScheduled']
  beforeAll(async () => {
    runScheduled = (await import('./scheduled')).runScheduled
  }, 30_000)

  beforeEach(() => {
    sendMock.mockReset()
    sendMock.mockResolvedValue(undefined)
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('no-fire tick: enqueues nothing', async () => {
    await runScheduled(fakeEvent(NO_FIRE_MINUTE), fakeEnv)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('single firing channel: enqueues one GenJob carrying channel + scheduledTime', async () => {
    const t = channelAMinute(1)
    await runScheduled(fakeEvent(t), fakeEnv)

    expect(sendMock).toHaveBeenCalledTimes(1)
    const job = sendMock.mock.calls[0]![0] as GenJob
    expect(job).toEqual({ channel: 'generation-a', scheduledTimeMs: t })
  })

  it('multi-channel tick: one GenJob per channel, in schedule order', async () => {
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
    const t = coincidenceMinute * MIN
    const firingChannels = chooseFires(t, SCHEDULES)

    await runScheduled(fakeEvent(t), fakeEnv)

    expect(sendMock).toHaveBeenCalledTimes(firingChannels.length)
    const enqueuedChannels = sendMock.mock.calls.map((c) => (c[0] as GenJob).channel)
    expect(enqueuedChannels).toEqual([...firingChannels])
    for (const call of sendMock.mock.calls) {
      expect((call[0] as GenJob).scheduledTimeMs).toBe(t)
    }
  })
})
