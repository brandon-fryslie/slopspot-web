// [LAW:behavior-not-structure] These tests assert createPost's contract when a
// D1 batch returns success:false on the sibling-table INSERT — a silent failure
// drizzle's mapRunResult never surfaces as a throw. They do not test real D1
// semantics (miniflare can't simulate per-statement success:false); they test
// the guard logic that detects and surfaces the failure.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreatePostInput } from '~/db/posts'
import { ProviderId } from '~/lib/domain'

// Drizzle fluent chain returns `this` at each step, with batch as the terminal.
// The mock must satisfy: db(env).insert(table).values(row) → a batchable token,
// db(env).batch([...tokens]) → the array of D1Result-shaped objects.
const mockBatch = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()
// Captured at module scope so tests can assert on it directly without reading
// mock.results (which is empty before getProvider has been called in the test).
const mockGenerate = vi.fn()

vi.mock('~/db/client', () => ({
  db: () => ({
    batch: mockBatch,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
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

// eq is used in the update/delete chain — not reached in failure tests, but the
// import must resolve.
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))

// Provider mock: paramsSchema accepts any object; generate is mockGenerate so
// tests can assert it was or was not called across any iteration.
vi.mock('~/providers', () => ({
  getProvider: vi.fn().mockReturnValue({
    id: 'test-provider',
    version: '1',
    paramsSchema: {
      safeParse: (v: unknown) => ({ success: true, data: v }),
    },
    generate: mockGenerate,
    capabilities: { costEstimateUsd: 0 },
  }),
}))

vi.mock('~/storage/ingest', () => ({ ingestImage: vi.fn() }))

const fakeEnv = {} as Env

const GENERATION_INPUT: CreatePostInput = {
  kind: 'generation',
  providerId: ProviderId('test-provider'),
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

// Batch result where the first statement succeeded but the second (sibling table)
// returned success:false — the exact shape of D1's per-statement silent failure.
function batchWithSecondFailure(errorMsg = 'UNIQUE constraint failed') {
  return [{ success: true, results: [], meta: {} }, { success: false, error: errorMsg }]
}

// Batch result where the first statement (posts INSERT) itself failed.
function batchWithFirstFailure(errorMsg = 'UNIQUE constraint failed') {
  return [{ success: false, error: errorMsg }, { success: false, error: 'FK constraint' }]
}

describe('app/db/posts.ts — batch INSERT success validation', () => {
  beforeEach(() => {
    mockInsert.mockReturnValue({ values: vi.fn().mockReturnThis() })
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    })
    mockDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('createGenerationPost', () => {
    it('throws when generations INSERT returns success:false — does not call provider or delete orphan', async () => {
      mockBatch.mockResolvedValue(batchWithSecondFailure('constraint error'))

      const { createPost } = await import('~/db/posts')
      await expect(createPost(GENERATION_INPUT, { env: fakeEnv })).rejects.toThrow(
        'generations INSERT failed: constraint error',
      )

      expect(mockGenerate).not.toHaveBeenCalled()
      // D1 batch is not transactional — the posts row may have committed. Cleanup runs.
      expect(mockDelete).toHaveBeenCalled()
    })

    it('throws when posts INSERT returns success:false — no orphan delete (posts row was never written)', async () => {
      mockBatch.mockResolvedValue(batchWithFirstFailure('posts constraint'))

      const { createPost } = await import('~/db/posts')
      await expect(createPost(GENERATION_INPUT, { env: fakeEnv })).rejects.toThrow(
        'posts INSERT failed: posts constraint',
      )

      expect(mockGenerate).not.toHaveBeenCalled()
      expect(mockDelete).not.toHaveBeenCalled()
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

    it('batch guard passes — later provider error propagates, not a guard error', async () => {
      mockBatch.mockResolvedValue([{ success: true }, { success: true }])
      mockGenerate.mockRejectedValueOnce(new Error('provider-error'))

      const { createPost } = await import('~/db/posts')
      await expect(createPost(GENERATION_INPUT, { env: fakeEnv })).rejects.toThrow('provider-error')
    })
  })

  describe('createFoundPost', () => {
    it('throws when found INSERT returns success:false and deletes the orphan posts row', async () => {
      mockBatch.mockResolvedValue(batchWithSecondFailure('constraint error'))

      const { createPost } = await import('~/db/posts')
      await expect(createPost(FOUND_INPUT, { env: fakeEnv })).rejects.toThrow(
        'found INSERT failed: constraint error',
      )
      expect(mockDelete).toHaveBeenCalled()
    })

    it('throws when posts INSERT returns success:false — no orphan delete', async () => {
      mockBatch.mockResolvedValue(batchWithFirstFailure('posts constraint'))

      const { createPost } = await import('~/db/posts')
      await expect(createPost(FOUND_INPUT, { env: fakeEnv })).rejects.toThrow(
        'posts INSERT failed: posts constraint',
      )
      expect(mockDelete).not.toHaveBeenCalled()
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

    it('batch guard passes — returns Post domain object', async () => {
      mockBatch.mockResolvedValue([{ success: true }, { success: true }])

      const { createPost } = await import('~/db/posts')
      await expect(createPost(FOUND_INPUT, { env: fakeEnv })).resolves.toMatchObject({
        content: { kind: 'found', url: FOUND_INPUT.url },
      })
    })
  })
})
