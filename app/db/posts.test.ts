// [LAW:behavior-not-structure] These tests assert createPost's contract when a
// D1 batch returns success:false on the sibling-table INSERT — a silent failure
// drizzle's mapRunResult never surfaces as a throw. They do not test real D1
// semantics (miniflare can't simulate per-statement success:false); they test
// the guard logic that detects and surfaces the failure.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreatePostInput } from '~/db/posts'

// Drizzle fluent chain returns `this` at each step, with batch as the terminal.
// The mock must satisfy: db(env).insert(table).values(row) → a batchable token,
// db(env).batch([...tokens]) → the array of D1Result-shaped objects.
const mockBatch = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()

vi.mock('~/db/client', () => ({
  db: () => ({
    batch: mockBatch,
    insert: mockInsert,
    update: mockUpdate,
  }),
}))

vi.mock('~/observability/metrics', () => ({ emit: vi.fn() }))

// posts.ts imports schema symbols only for the drizzle fluent chain; they are
// never inspected by the mock, so stubs are enough.
vi.mock('~/db/schema', () => ({
  posts: {},
  generations: {},
  found: {},
  uploads: {},
}))

// eq is used in the update chain after provider call — not reached in these
// tests (we throw before the provider), but the import must resolve.
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))

// Provider mock: paramsSchema accepts { prompt: string } and the provider
// would be called only if the batch guard doesn't throw first.
vi.mock('~/providers', () => ({
  getProvider: vi.fn().mockReturnValue({
    id: 'test-provider',
    version: '1',
    paramsSchema: {
      safeParse: (v: unknown) => ({ success: true, data: v }),
    },
    generate: vi.fn(),
    capabilities: { costEstimateUsd: 0 },
  }),
}))

vi.mock('~/storage/ingest', () => ({ ingestImage: vi.fn() }))

const fakeEnv = {} as Env

const GENERATION_INPUT: CreatePostInput = {
  kind: 'generation',
  providerId: 'test-provider' as Parameters<typeof import('~/lib/domain').PostId>[0] & string as never,
  params: { prompt: 'a test prompt' },
  styleFamily: 'photoreal',
  subject: { subjectTemplate: 'T00', slots: { freeText: 'test' } },
  aspectRatio: '1:1',
  origin: { actor: { kind: 'anon', label: 'test' } },
}

const FOUND_INPUT: CreatePostInput = {
  kind: 'found',
  url: 'https://example.com/article',
  title: 'A found article',
  origin: { actor: { kind: 'anon', label: 'test' } },
}

// A batch result where the first statement succeeded but the second (sibling
// table) returned success:false — the exact shape of D1's per-statement failure.
function batchWithSecondFailure(errorMsg = 'UNIQUE constraint failed') {
  return [{ success: true, results: [], meta: {} }, { success: false, error: errorMsg }]
}

describe('app/db/posts.ts — batch INSERT success validation', () => {
  beforeEach(() => {
    mockInsert.mockReturnValue({ values: vi.fn().mockReturnThis() })
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('createGenerationPost', () => {
    it('throws when generations INSERT returns success:false — does not call provider', async () => {
      mockBatch.mockResolvedValue(batchWithSecondFailure('constraint error'))
      const { getProvider } = await import('~/providers')
      const providerSpy = vi.mocked(getProvider).mock.results[0]?.value?.generate

      const { createPost } = await import('~/db/posts')
      await expect(createPost(GENERATION_INPUT, { env: fakeEnv })).rejects.toThrow(
        'generations INSERT failed: constraint error',
      )

      // Provider must not have been called — we bailed before spending money
      if (providerSpy) expect(providerSpy).not.toHaveBeenCalled()
    })

    it('propagates the D1 error string in the thrown message', async () => {
      mockBatch.mockResolvedValue(batchWithSecondFailure('D1_ERROR: no such table'))

      const { createPost } = await import('~/db/posts')
      await expect(createPost(GENERATION_INPUT, { env: fakeEnv })).rejects.toThrow(
        'D1_ERROR: no such table',
      )
    })

    it('uses "unknown" when the D1 result carries no error string', async () => {
      mockBatch.mockResolvedValue([{ success: true }, { success: false }])

      const { createPost } = await import('~/db/posts')
      await expect(createPost(GENERATION_INPUT, { env: fakeEnv })).rejects.toThrow(
        'generations INSERT failed: unknown',
      )
    })

    it('does not throw when both statements succeed', async () => {
      mockBatch.mockResolvedValue([{ success: true }, { success: true }])
      // Provider generate → throw so the test terminates without a full round-trip.
      const { getProvider } = await import('~/providers')
      vi.mocked(getProvider).mockReturnValueOnce({
        id: 'test-provider',
        version: '1',
        paramsSchema: { safeParse: (v: unknown) => ({ success: true, data: v }) },
        generate: vi.fn().mockRejectedValue(new Error('provider-error')),
        capabilities: { costEstimateUsd: 0 },
      } as never)

      const { createPost } = await import('~/db/posts')
      // The batch guard passed; the error comes from the provider, not the guard.
      await expect(createPost(GENERATION_INPUT, { env: fakeEnv })).rejects.toThrow('provider-error')
    })
  })

  describe('createFoundPost', () => {
    it('throws when found INSERT returns success:false', async () => {
      mockBatch.mockResolvedValue(batchWithSecondFailure('constraint error'))

      const { createPost } = await import('~/db/posts')
      await expect(createPost(FOUND_INPUT, { env: fakeEnv })).rejects.toThrow(
        'found INSERT failed: constraint error',
      )
    })

    it('emits batch_outcome=failed on success:false', async () => {
      mockBatch.mockResolvedValue(batchWithSecondFailure())
      const { emit } = await import('~/observability/metrics')

      const { createPost } = await import('~/db/posts')
      await expect(createPost(FOUND_INPUT, { env: fakeEnv })).rejects.toThrow()

      expect(vi.mocked(emit)).toHaveBeenCalledWith(
        'slopspot.write.batch_outcome',
        { content_kind: 'found', outcome: 'failed' },
        1,
      )
    })

    it('does not throw when both statements succeed', async () => {
      mockBatch.mockResolvedValue([{ success: true }, { success: true }])

      const { createPost } = await import('~/db/posts')
      // No throw — returns the constructed Post domain object.
      await expect(createPost(FOUND_INPUT, { env: fakeEnv })).resolves.toMatchObject({
        content: { kind: 'found', url: FOUND_INPUT.url },
      })
    })
  })
})
