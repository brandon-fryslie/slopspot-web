// [LAW:behavior-not-structure] Locks authorSlop's wiring contract: a WISH occasion
// produces a slop AUTHORED by the seated persona, with the human as a `wisher`
// MODIFIER, the wish carried to createPost as provenance, the wish NEVER in the
// provider params, and the signed remark recorded once; the firehose path (no
// occasion) carries no human, no wish, and no remark. The heavy seams (createPost,
// getRecentRecipes, recordRemark) are mocked so this asserts the WIRING
// deterministically with no D1, no network, no provider call — the actual
// persistence is proven by the route integration test (app/routes/__tests__).
//
// [LAW:one-type-per-behavior] This is the same authorSlop both the firehose and the
// Well route call — the test exercises both paths through it to prove the only
// difference is DATA (the occasion), not a forked pipeline.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const createPostMock = vi.fn()
const recordRemarkMock = vi.fn()
const getRecentRecipesMock = vi.fn()

vi.mock('~/db/posts', () => ({
  createPost: (...args: unknown[]) => createPostMock(...args),
}))
vi.mock('~/db/recent', () => ({
  getRecentRecipes: (...args: unknown[]) => getRecentRecipesMock(...args),
}))
vi.mock('~/db/remark', () => ({
  recordRemark: (...args: unknown[]) => recordRemarkMock(...args),
}))

// Side-effect import: register the real providers so getProvider('fal-flux-mock')
// resolves the actual mock provider (pure, no env, no network).
import '~/providers'
import { authorSlop } from '~/agents/generator'
import { AgentId, PostId, type HumanRef } from '~/lib/domain'
import type { Persona } from '~/agents/persona'

// No SLOPSPOT_ANTHROPIC_API_KEY on this env → composePrompt takes its deterministic
// recipe-only fallback (no fetch). No SLOPSPOT_ENV → not prod → a mock medium is
// allowed (the prod-mock guard does not fire).
const env = {} as Env

const persona: Persona = {
  agentId: AgentId('agent:test-gen'),
  handle: 'test-gen',
  displayName: 'Test Citizen',
  role: 'generator',
  personaPrompt: 'an austere maker',
  modelId: 'claude-haiku-4-5',
  config: { medium: 'fal-flux-mock' },
}

const wisher: HumanRef = { kind: 'anon', label: 'anon-abc123' }

beforeEach(() => {
  createPostMock.mockReset()
  recordRemarkMock.mockReset()
  getRecentRecipesMock.mockReset()
  getRecentRecipesMock.mockResolvedValue([])
  createPostMock.mockResolvedValue({ id: PostId('post-abc') })
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('authorSlop — the wish path (the Well)', () => {
  it('authors as the seated persona, with the wisher modifier, the wish, and a signed remark', async () => {
    await authorSlop(env, persona, 12345, {
      wish: 'a lighthouse at the end of the world',
      wisher,
    })

    expect(createPostMock).toHaveBeenCalledTimes(1)
    const input = createPostMock.mock.calls[0]![0] as {
      kind: string
      wish?: string
      origin: { kind: string; author: unknown; human?: unknown }
    }
    expect(input.kind).toBe('generation')
    // The author is the persona; the human is only the wisher MODIFIER.
    expect(input.origin.kind).toBe('authored')
    expect(input.origin.author).toEqual({ kind: 'agent', agentId: 'agent:test-gen' })
    expect(input.origin.human).toEqual({ role: 'wisher', by: wisher })
    // The wish persists as provenance.
    expect(input.wish).toBe('a lighthouse at the end of the world')

    // The signed remark is recorded once, narrating the completed slop's id.
    expect(recordRemarkMock).toHaveBeenCalledTimes(1)
    const [, recordedPostId, remark] = recordRemarkMock.mock.calls[0]! as [
      Env,
      PostId,
      { kind: string; text?: string },
    ]
    expect(recordedPostId).toBe('post-abc')
    expect(remark.kind).toBe('spoke')
    expect(remark.text).toContain('a lighthouse at the end of the world')
  })

  it('never passes the wish raw into the provider params', async () => {
    // foundation.3/.4 isolation: the wish steers composition but is never the prompt.
    // On the fallback path (no API key) the wish is omitted from the prompt entirely,
    // so a unique token from the wish cannot appear in the provider-native params.
    await authorSlop(env, persona, 1, {
      wish: 'ZZZ_UNIQUE_WISH_TOKEN_ZZZ',
      wisher,
    })
    const input = createPostMock.mock.calls[0]![0] as { params: { prompt: string } }
    expect(input.params.prompt).not.toContain('ZZZ_UNIQUE_WISH_TOKEN_ZZZ')
  })
})

describe('authorSlop — the firehose path (no occasion)', () => {
  it('authors with no human, no wish, and records no remark', async () => {
    await authorSlop(env, persona, 12345)

    const input = createPostMock.mock.calls[0]![0] as {
      wish?: string
      origin: { human?: unknown }
    }
    expect(input.origin.human).toBeUndefined()
    expect(input.wish).toBeUndefined()
    // No wish → no AnsweredWish → nothing to narrate. The remark is absent by the
    // shape of the data, not a guard.
    expect(recordRemarkMock).not.toHaveBeenCalled()
  })
})
