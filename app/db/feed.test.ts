// [LAW:behavior-not-structure] The read-side dual of the wish persistence test
// in posts.test.ts: that proves createPost WRITES the wish to the generations
// row; this proves the storage→domain reader RECONSTRUCTS it. The mapping line
// `wish: g.wish ?? undefined` is an optional field — deleting it compiles clean,
// so tsc cannot catch read-side drift; only this test can. We assert both halves
// of the optional mapping: a stored wish round-trips verbatim, and a NULL column
// (every non-Well generation) becomes `undefined`, never a laundered null.
//
// Same drizzle-chain mock philosophy as posts.test.ts — getPostById is the one
// single-query reader (no fetchCitizenRefs enrichment), so the chain is a single
// select→from→leftJoin×3→where→limit that resolves to one row.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderId } from '~/lib/domain'

const mockSelect = vi.fn()
const mockLimit = vi.fn()

// Fluent select chain returning `this` until the terminal `.limit()`.
const selectChain = {
  from: () => selectChain,
  leftJoin: () => selectChain,
  where: () => selectChain,
  limit: mockLimit,
}

vi.mock('~/db/client', () => ({
  db: () => ({ select: mockSelect }),
}))

vi.mock('~/observability/metrics', () => ({ emit: vi.fn() }))

// Schema tables are passed only as opaque references into the (mocked) select /
// leftJoin / eq calls — never inspected — so stubs suffice, mirroring posts.test.ts.
vi.mock('~/db/schema', () => ({
  posts: {},
  generations: {},
  uploads: {},
  found: {},
  comments: {},
  votes: {},
  personas: {},
}))

// getPostById uses `eq`; the rest are imported at module load for other readers.
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}))
vi.mock('drizzle-orm/sqlite-core', () => ({ alias: vi.fn() }))

const fakeEnv = {} as Env

// A succeeded generation row with all arms cleared except 'succeeded', so
// toStatus/toContent reconstruct without tripping a fail-loud guard. `wish` is
// the field under test.
function generationRow(wish: string | null) {
  return {
    post: {
      id: 'post-1',
      createdAt: new Date(0),
      contentKind: 'generation' as const,
      // A Well-born origin: persona author + human wisher.
      originJson: JSON.stringify({
        kind: 'authored',
        author: { kind: 'agent', agentId: 'agent:test' },
        human: { role: 'wisher', by: { kind: 'anon', label: 'a hopeful human' } },
      }),
    },
    generation: {
      postId: 'post-1',
      providerId: ProviderId('test-provider'),
      providerVersion: '1',
      paramsJson: '{"prompt":"a machine-composed prompt"}',
      parentPostId: null,
      styleFamily: 'photoreal',
      subjectTemplate: 'T00',
      slotsJson: '{"freeText":"x"}',
      aspectRatio: '1:1',
      wish,
      status: 'succeeded' as const,
      queuedAt: null,
      startedAt: null,
      completedAt: new Date(0),
      outputJson: '{"kind":"image","url":"/media/abc","w":1,"h":1}',
      failedAt: null,
      failedReason: null,
    },
    upload: null,
    found: null,
  }
}

describe('app/db/feed.ts — getPostById wish reconstruction', () => {
  beforeEach(() => {
    mockSelect.mockReturnValue(selectChain)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('reconstructs a stored wish verbatim onto the recipe', async () => {
    const WISH = 'WISH_SENTINEL_a_lighthouse_at_the_end_of_the_world'
    mockLimit.mockResolvedValueOnce([generationRow(WISH)])

    const { getPostById } = await import('~/db/feed')
    const post = await getPostById(fakeEnv, 'post-1' as never)

    expect(post).not.toBeNull()
    expect(post!.content.kind).toBe('generation')
    if (post!.content.kind === 'generation') {
      expect(post!.content.recipe.wish).toBe(WISH)
    }
  })

  it('maps a NULL wish column to undefined, never a laundered null', async () => {
    mockLimit.mockResolvedValueOnce([generationRow(null)])

    const { getPostById } = await import('~/db/feed')
    const post = await getPostById(fakeEnv, 'post-1' as never)

    expect(post!.content.kind).toBe('generation')
    if (post!.content.kind === 'generation') {
      // [LAW:no-defensive-null-guards] absence is `undefined` (a legal optional),
      // not `null` smuggled through — the property is genuinely absent.
      expect(post!.content.recipe.wish).toBeUndefined()
      expect('wish' in post!.content.recipe ? post!.content.recipe.wish : undefined).toBeUndefined()
    }
  })
})
