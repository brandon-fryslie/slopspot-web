// [LAW:behavior-not-structure] Tests assert pipeline contracts: given stubbed
// persona/feed/z.ai scores, does runVoterPass produce the correct setVote calls?
// The test does NOT assert the internal score-parsing logic or URL construction —
// it asserts the observable outcome: which posts get voted on, with what value.
//
// [LAW:verifiable-goals] Three-candidate matrix: one upvote, one downvote, one
// abstain — confirms each branch of the score→intent map fires correctly and
// that abstains do NOT produce a setVote call.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AgentId, PostId, ProviderId } from '~/lib/domain'
import type { FeedItem, Post, VoteValue } from '~/lib/domain'
import type { StyleFamily, AspectRatio } from '~/lib/variety'

// Module-level mocks — hoisted before imports.
vi.mock('~/agents/persona', () => ({
  pickPersona: vi.fn(),
}))
vi.mock('~/agents/zai', () => ({
  chat: vi.fn(),
}))
vi.mock('~/db/feed', () => ({
  getFeed: vi.fn(),
}))
vi.mock('~/db/votes', () => ({
  setVote: vi.fn(),
}))
vi.mock('~/observability/metrics', () => ({
  emit: vi.fn(),
}))

import { runVoterPass } from './voter'
import { pickPersona } from '~/agents/persona'
import { chat } from '~/agents/zai'
import { getFeed } from '~/db/feed'
import { setVote } from '~/db/votes'

// ─── Stub helpers ────────────────────────────────────────────────────────────

const STUB_PERSONA = {
  agentId: AgentId('agent:aesthete'),
  displayName: 'The Aesthete',
  role: 'voter' as const,
  personaPrompt: 'You are a discerning critic.',
  modelId: 'glm-4v-flash',
  config: {
    upvoteThreshold: 70,
    downvoteThreshold: 30,
    votesPerPass: 5,
  },
}

function makePost(id: string): Post {
  return {
    id: PostId(id),
    createdAt: new Date('2026-01-01'),
    content: {
      kind: 'generation',
      recipe: {
        providerId: ProviderId('fal-flux'),
        providerVersion: '1',
        params: {},
        styleFamily: 'cinematic' as StyleFamily,
        aspectRatio: '16:9' as AspectRatio,
        subject: { subjectTemplate: 'T01', slots: { animal: 'cat', profession: 'chef' } },
      },
      status: {
        kind: 'succeeded',
        output: {
          kind: 'image',
          url: `/media/sha256-${id}`,
          w: 1024,
          h: 576,
        },
        completedAt: new Date('2026-01-01'),
      },
    },
    origin: {
      actor: { kind: 'agent', agentId: AgentId('sys:slop-cron') },
    },
  }
}

function makeFeedItem(id: string, myVote: VoteValue | null = null): FeedItem {
  return {
    post: makePost(id),
    score: 0,
    myVote,
    commentCount: 0,
    rank: 1,
  }
}

const STUB_ENV = {
  SLOPSPOT_SITE_URL: 'https://slopspot.ai',
} as unknown as Env

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('runVoterPass', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips when no voter personas are configured', async () => {
    vi.mocked(pickPersona).mockResolvedValue(null)

    await runVoterPass(STUB_ENV, Date.now())

    expect(getFeed).not.toHaveBeenCalled()
    expect(setVote).not.toHaveBeenCalled()
  })

  it('upvote / downvote / abstain matrix — correct setVote calls', async () => {
    vi.mocked(pickPersona).mockResolvedValue(STUB_PERSONA)

    // Three candidates: upvote (score 85), abstain (score 50), downvote (score 15).
    vi.mocked(getFeed).mockResolvedValue([
      makeFeedItem('post-a'),
      makeFeedItem('post-b'),
      makeFeedItem('post-c'),
    ])

    vi.mocked(chat)
      .mockResolvedValueOnce('85')  // post-a → upvote (>70)
      .mockResolvedValueOnce('50')  // post-b → abstain (30–70)
      .mockResolvedValueOnce('15')  // post-c → downvote (<30)

    await runVoterPass(STUB_ENV, Date.now())

    expect(setVote).toHaveBeenCalledTimes(2)
    expect(setVote).toHaveBeenCalledWith(
      { postId: PostId('post-a'), voterId: 'agent:aesthete', value: 1 },
      { env: STUB_ENV },
    )
    expect(setVote).toHaveBeenCalledWith(
      { postId: PostId('post-c'), voterId: 'agent:aesthete', value: -1 },
      { env: STUB_ENV },
    )
    // post-b abstain → no setVote call
    expect(setVote).not.toHaveBeenCalledWith(
      expect.objectContaining({ postId: PostId('post-b') }),
      expect.anything(),
    )
  })

  it('skips already-voted candidates (myVote is not null)', async () => {
    vi.mocked(pickPersona).mockResolvedValue(STUB_PERSONA)
    vi.mocked(getFeed).mockResolvedValue([
      makeFeedItem('post-already-voted', 1),  // already upvoted — skipped
      makeFeedItem('post-fresh'),
    ])
    vi.mocked(chat).mockResolvedValueOnce('90')

    await runVoterPass(STUB_ENV, Date.now())

    expect(setVote).toHaveBeenCalledTimes(1)
    expect(setVote).toHaveBeenCalledWith(
      expect.objectContaining({ postId: PostId('post-fresh') }),
      expect.anything(),
    )
  })

  it('skips posts authored by the same agent', async () => {
    vi.mocked(pickPersona).mockResolvedValue(STUB_PERSONA)

    // Build a post where origin.actor IS this agent.
    const selfPost = makePost('self-post')
    const selfPostItem: FeedItem = {
      post: {
        ...selfPost,
        origin: { actor: { kind: 'agent', agentId: AgentId('agent:aesthete') } },
      },
      score: 0,
      myVote: null,
      commentCount: 0,
      rank: 1,
    }

    vi.mocked(getFeed).mockResolvedValue([selfPostItem, makeFeedItem('other-post')])
    vi.mocked(chat).mockResolvedValueOnce('95')

    await runVoterPass(STUB_ENV, Date.now())

    expect(setVote).toHaveBeenCalledTimes(1)
    expect(setVote).toHaveBeenCalledWith(
      expect.objectContaining({ postId: PostId('other-post') }),
      expect.anything(),
    )
  })

  it('respects votesPerPass cap', async () => {
    vi.mocked(pickPersona).mockResolvedValue({
      ...STUB_PERSONA,
      config: { ...STUB_PERSONA.config, votesPerPass: 2 },
    })

    vi.mocked(getFeed).mockResolvedValue([
      makeFeedItem('p1'),
      makeFeedItem('p2'),
      makeFeedItem('p3'),
    ])
    vi.mocked(chat).mockResolvedValue('85')  // all upvotes

    await runVoterPass(STUB_ENV, Date.now())

    expect(setVote).toHaveBeenCalledTimes(2)
    expect(chat).toHaveBeenCalledTimes(2)
  })

  it('skips candidate when z.ai returns non-numeric score', async () => {
    vi.mocked(pickPersona).mockResolvedValue(STUB_PERSONA)
    vi.mocked(getFeed).mockResolvedValue([
      makeFeedItem('post-bad-score'),
      makeFeedItem('post-good'),
    ])
    vi.mocked(chat)
      .mockResolvedValueOnce('not-a-number')
      .mockResolvedValueOnce('90')

    await runVoterPass(STUB_ENV, Date.now())

    expect(setVote).toHaveBeenCalledTimes(1)
    expect(setVote).toHaveBeenCalledWith(
      expect.objectContaining({ postId: PostId('post-good') }),
      expect.anything(),
    )
  })

  it('skips candidate when z.ai call throws', async () => {
    vi.mocked(pickPersona).mockResolvedValue(STUB_PERSONA)
    vi.mocked(getFeed).mockResolvedValue([
      makeFeedItem('post-zai-fail'),
      makeFeedItem('post-ok'),
    ])
    vi.mocked(chat)
      .mockRejectedValueOnce(new Error('z.ai timeout'))
      .mockResolvedValueOnce('80')

    await runVoterPass(STUB_ENV, Date.now())

    expect(setVote).toHaveBeenCalledTimes(1)
    expect(setVote).toHaveBeenCalledWith(
      expect.objectContaining({ postId: PostId('post-ok') }),
      expect.anything(),
    )
  })

  it('skips non-generation posts (upload, found)', async () => {
    vi.mocked(pickPersona).mockResolvedValue(STUB_PERSONA)

    const uploadItem: FeedItem = {
      post: {
        id: PostId('upload-post'),
        createdAt: new Date(),
        content: {
          kind: 'upload',
          asset: { kind: 'image', url: '/media/some-key', w: 100, h: 100 },
        },
        origin: { actor: { kind: 'anon', label: 'anon' } },
      },
      score: 0,
      myVote: null,
      commentCount: 0,
      rank: 1,
    }

    vi.mocked(getFeed).mockResolvedValue([uploadItem, makeFeedItem('gen-post')])
    vi.mocked(chat).mockResolvedValueOnce('90')

    await runVoterPass(STUB_ENV, Date.now())

    expect(setVote).toHaveBeenCalledTimes(1)
    expect(setVote).toHaveBeenCalledWith(
      expect.objectContaining({ postId: PostId('gen-post') }),
      expect.anything(),
    )
  })

  it('skips candidate when media URL is not a /media/ path', async () => {
    vi.mocked(pickPersona).mockResolvedValue(STUB_PERSONA)

    const post = makePost('bad-url-post')
    const badUrlPost = {
      ...post,
      content: {
        ...(post.content as Extract<typeof post.content, { kind: 'generation' }>),
        status: {
          kind: 'succeeded' as const,
          output: { kind: 'image' as const, url: 'https://external.example.com/image.jpg', w: 100, h: 100 },
          completedAt: new Date(),
        },
      },
    }

    vi.mocked(getFeed).mockResolvedValue([
      { post: badUrlPost, score: 0, myVote: null, commentCount: 0, rank: 1 },
      makeFeedItem('good-post'),
    ])
    vi.mocked(chat).mockResolvedValueOnce('90')

    await runVoterPass(STUB_ENV, Date.now())

    expect(setVote).toHaveBeenCalledTimes(1)
    expect(setVote).toHaveBeenCalledWith(
      expect.objectContaining({ postId: PostId('good-post') }),
      expect.anything(),
    )
  })
})
