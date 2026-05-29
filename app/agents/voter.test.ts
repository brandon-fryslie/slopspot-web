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
    vi.mocked(setVote).mockResolvedValue({ ok: true, score: 1, value: 1 })
  })

  it('upvote / downvote / abstain matrix — correct setVote calls', async () => {
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

    await runVoterPass(STUB_ENV, STUB_PERSONA)

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
    vi.mocked(getFeed).mockResolvedValue([
      makeFeedItem('post-already-voted', 1),  // already upvoted — skipped
      makeFeedItem('post-fresh'),
    ])
    vi.mocked(chat).mockResolvedValueOnce('90')

    await runVoterPass(STUB_ENV, STUB_PERSONA)

    expect(setVote).toHaveBeenCalledTimes(1)
    expect(setVote).toHaveBeenCalledWith(
      expect.objectContaining({ postId: PostId('post-fresh') }),
      expect.anything(),
    )
  })

  it('skips posts authored by the same agent', async () => {
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

    await runVoterPass(STUB_ENV, STUB_PERSONA)

    expect(setVote).toHaveBeenCalledTimes(1)
    expect(setVote).toHaveBeenCalledWith(
      expect.objectContaining({ postId: PostId('other-post') }),
      expect.anything(),
    )
  })

  it('respects votesPerPass cap', async () => {
    vi.mocked(getFeed).mockResolvedValue([
      makeFeedItem('p1'),
      makeFeedItem('p2'),
      makeFeedItem('p3'),
    ])
    vi.mocked(chat).mockResolvedValue('85')  // all upvotes

    await runVoterPass(STUB_ENV, { ...STUB_PERSONA, config: { ...STUB_PERSONA.config, votesPerPass: 2 } })

    expect(setVote).toHaveBeenCalledTimes(2)
    expect(chat).toHaveBeenCalledTimes(2)
  })

  it('skips candidate when z.ai returns non-numeric score', async () => {
    vi.mocked(getFeed).mockResolvedValue([
      makeFeedItem('post-bad-score'),
      makeFeedItem('post-good'),
    ])
    vi.mocked(chat)
      .mockResolvedValueOnce('not-a-number')
      .mockResolvedValueOnce('90')

    await runVoterPass(STUB_ENV, STUB_PERSONA)

    expect(setVote).toHaveBeenCalledTimes(1)
    expect(setVote).toHaveBeenCalledWith(
      expect.objectContaining({ postId: PostId('post-good') }),
      expect.anything(),
    )
  })

  it('skips candidate when z.ai call throws', async () => {
    vi.mocked(getFeed).mockResolvedValue([
      makeFeedItem('post-zai-fail'),
      makeFeedItem('post-ok'),
    ])
    vi.mocked(chat)
      .mockRejectedValueOnce(new Error('z.ai timeout'))
      .mockResolvedValueOnce('80')

    await runVoterPass(STUB_ENV, STUB_PERSONA)

    expect(setVote).toHaveBeenCalledTimes(1)
    expect(setVote).toHaveBeenCalledWith(
      expect.objectContaining({ postId: PostId('post-ok') }),
      expect.anything(),
    )
  })

  it('rejects partial-numeric scores like "85/100" that parseInt would accept', async () => {
    vi.mocked(getFeed).mockResolvedValue([
      makeFeedItem('post-partial'),
      makeFeedItem('post-clean'),
    ])
    vi.mocked(chat)
      .mockResolvedValueOnce('85/100')  // partial — parseInt gives 85 but regex rejects it
      .mockResolvedValueOnce('90')

    await runVoterPass(STUB_ENV, STUB_PERSONA)

    expect(setVote).toHaveBeenCalledTimes(1)
    expect(setVote).toHaveBeenCalledWith(
      expect.objectContaining({ postId: PostId('post-clean') }),
      expect.anything(),
    )
  })

  it('skips non-generation posts (upload, found)', async () => {
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

    await runVoterPass(STUB_ENV, STUB_PERSONA)

    expect(setVote).toHaveBeenCalledTimes(1)
    expect(setVote).toHaveBeenCalledWith(
      expect.objectContaining({ postId: PostId('gen-post') }),
      expect.anything(),
    )
  })

  it('skips candidate when media URL is not a /media/ path', async () => {
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

    await runVoterPass(STUB_ENV, STUB_PERSONA)

    expect(setVote).toHaveBeenCalledTimes(1)
    expect(setVote).toHaveBeenCalledWith(
      expect.objectContaining({ postId: PostId('good-post') }),
      expect.anything(),
    )
  })

  it('does not emit vote metric when setVote returns post_not_found', async () => {
    const { emit } = await import('~/observability/metrics')

    vi.mocked(getFeed).mockResolvedValue([makeFeedItem('deleted-post')])
    vi.mocked(chat).mockResolvedValueOnce('90')
    vi.mocked(setVote).mockResolvedValueOnce({ ok: false, reason: 'post_not_found' })

    await runVoterPass(STUB_ENV, STUB_PERSONA)

    expect(setVote).toHaveBeenCalledTimes(1)
    expect(emit).not.toHaveBeenCalledWith('slopspot.voter.vote', expect.anything(), expect.anything())
  })

  it('continues remaining candidates when setVote throws a D1 error', async () => {
    vi.mocked(getFeed).mockResolvedValue([
      makeFeedItem('post-db-error'),
      makeFeedItem('post-ok'),
    ])
    vi.mocked(chat).mockResolvedValue('90')
    vi.mocked(setVote)
      .mockRejectedValueOnce(new Error('D1_ERROR: connection timeout'))
      .mockResolvedValueOnce({ ok: true, score: 1, value: 1 })

    await runVoterPass(STUB_ENV, STUB_PERSONA)

    expect(setVote).toHaveBeenCalledTimes(2)
    // Second candidate still voted despite first throwing
    expect(setVote).toHaveBeenCalledWith(
      expect.objectContaining({ postId: PostId('post-ok') }),
      expect.anything(),
    )
  })

  it('schema rejects inverted thresholds (downvoteThreshold >= upvoteThreshold)', async () => {
    vi.mocked(getFeed).mockResolvedValue([])

    const invertedPersona = {
      ...STUB_PERSONA,
      config: { upvoteThreshold: 20, downvoteThreshold: 80, votesPerPass: 5 },
    }

    await expect(runVoterPass(STUB_ENV, invertedPersona)).rejects.toThrow(
      'downvoteThreshold must be less than upvoteThreshold',
    )
    expect(setVote).not.toHaveBeenCalled()
  })
})
