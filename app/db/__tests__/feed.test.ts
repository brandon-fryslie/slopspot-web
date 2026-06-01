// [LAW:behavior-not-structure] These tests pin getFeed / getFeedItemById /
// getPostById's *contracts* - what shape they return for what storage state.
// They are deliberately blind to the helper decomposition (voteScoreSubquery,
// pickFeedIds, selectFeedRows): a refactor that keeps the contract intact must
// not require editing these tests, and a refactor that drifts must fail them.
//
// [LAW:types-are-the-program] The fact that these tests pass against a real D1
// isolate (not a mock) is load-bearing. The storage→domain trust boundary in
// feed.ts (Zod literal-union parses, `required`/`absent` guards, status
// exhaustiveness) only matters if real D1 rows can round-trip through it
// without launder. Mocks would let the boundary lie.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { getFeed, getFeedItemById, getPostById } from '~/db/feed'
import {
  AgentId,
  PostId,
  ProviderId,
  type FeedItem,
  type Origin,
  type RenderablePost,
} from '~/lib/domain'
import { fallbackTitle } from '~/lib/variety'
import { db } from '~/db/client'
import { personas } from '~/db/schema'
import { seedComment, seedPost, seedVote } from './helpers'

// [LAW:single-enforcer] One persona seeder for these tests — a critic must exist in
// the personas table for its vote's reasoning to resolve to a bylined verdict (the
// INNER JOIN feed.ts uses). Mirrors the seeder in persona.test.ts; the handle is a
// stable slug so repeated seeds don't collide on the unique constraint.
async function seedCritic(agentId: string, displayName: string): Promise<void> {
  await db(env)
    .insert(personas)
    .values({
      agentId,
      handle: agentId.replace('agent:', ''),
      displayName,
      role: 'voter',
      personaPrompt: `Prompt for ${agentId}`,
      modelId: 'glm-4v-flash',
      configJson: JSON.stringify({ upvoteThreshold: 70, downvoteThreshold: 30 }),
      createdAt: new Date(),
    })
}

// `1970-01-01T00:00:00.001Z` is the smallest distinct timestamp_ms; bumping by
// 1ms per post in test setup is enough to disambiguate createdAt ordering
// without making the test brittle to clock drift or system time.
function ms(n: number): Date {
  return new Date(n)
}

describe('app/db/feed.ts - getFeed', () => {
  it('returns [] when the posts table is empty', async () => {
    // [LAW:dataflow-not-control-flow] The empty case is data-flow degradation
    // (pickFeedIds returns []; inArray(posts.id, []) → WHERE FALSE), not an
    // early-return branch - but the contract is the same: no rows in, no
    // items out.
    const result = await getFeed(env)
    expect(result).toEqual([])
  })

  it('returns a single succeeded post with score 0, commentCount 0, myVote null, rank 1', async () => {
    const id = await seedPost(env, {
      id: 'post-baseline',
      createdAt: ms(1000),
    })

    const result = await getFeed(env)

    expect(result).toHaveLength(1)
    const item = result[0]
    expect(item.post.id).toBe(id)
    expect(item.post.createdAt).toEqual(ms(1000))
    expect(item.post.content.kind).toBe('generation')
    expect(item.score).toBe(0)
    expect(item.commentCount).toBe(0)
    expect(item.myVote).toBeNull()
    expect(item.rank).toBe(1)
  })

  describe('score aggregate', () => {
    it('sums multiple voters into score, including negatives', async () => {
      const id = await seedPost(env, { id: 'post-score' })
      await seedVote(env, { postId: id, voterId: 'voter-a', value: 1 })
      await seedVote(env, { postId: id, voterId: 'voter-b', value: 1 })
      await seedVote(env, { postId: id, voterId: 'voter-c', value: -1 })

      const [item] = await getFeed(env)
      expect(item.score).toBe(1)
    })

    it('a single -1 vote yields score -1', async () => {
      const id = await seedPost(env, { id: 'post-single-downvote' })
      await seedVote(env, { postId: id, voterId: 'voter-a', value: -1 })

      const [item] = await getFeed(env)
      expect(item.score).toBe(-1)
    })
  })

  describe('myVote arm', () => {
    it('returns the viewers own vote value when voterId matches a vote row', async () => {
      const id = await seedPost(env, { id: 'post-myvote' })
      await seedVote(env, { postId: id, voterId: 'voter-a', value: 1 })
      await seedVote(env, { postId: id, voterId: 'voter-b', value: -1 })

      const [asA] = await getFeed(env, 'voter-a')
      const [asB] = await getFeed(env, 'voter-b')
      expect(asA.myVote).toBe(1)
      expect(asB.myVote).toBe(-1)
    })

    it('returns null when the viewer has not voted on the post', async () => {
      const id = await seedPost(env, { id: 'post-no-myvote' })
      await seedVote(env, { postId: id, voterId: 'voter-a', value: 1 })

      const [asC] = await getFeed(env, 'voter-c')
      expect(asC.myVote).toBeNull()
    })

    it('returns null when no voterId is supplied (anon viewer)', async () => {
      const id = await seedPost(env, { id: 'post-anon-myvote' })
      await seedVote(env, { postId: id, voterId: 'voter-a', value: 1 })

      const [item] = await getFeed(env)
      expect(item.myVote).toBeNull()
    })
  })

  describe('commentCount aggregate', () => {
    it('counts comments per visible post', async () => {
      const target = await seedPost(env, { id: 'post-with-comments' })
      const other = await seedPost(env, { id: 'post-without-comments' })
      await seedComment(env, { id: 'c1', postId: target })
      await seedComment(env, { id: 'c2', postId: target })
      await seedComment(env, { id: 'c3', postId: target })

      const feed = await getFeed(env)
      const targetItem = feed.find((f) => f.post.id === target)
      const otherItem = feed.find((f) => f.post.id === other)
      expect(targetItem?.commentCount).toBe(3)
      expect(otherItem?.commentCount).toBe(0)
    })
  })

  describe('top window filtering (jc6.4)', () => {
    // Three posts seeded relative to now: 1h ago (in day and week), 3d ago
    // (in week only), 30d ago (in neither). The actual cutoff is computed by
    // getFeed via Date.now(), which is a few ms later than the test's `now` —
    // the hour/day/week boundaries give enough headroom that clock drift
    // between seeding and querying is irrelevant.
    it('window: "all" returns all posts regardless of age', async () => {
      const now = Date.now()
      const h1 = await seedPost(env, { id: 'window-1h', createdAt: new Date(now - 60 * 60 * 1000) })
      const d3 = await seedPost(env, { id: 'window-3d', createdAt: new Date(now - 3 * 24 * 60 * 60 * 1000) })
      const d30 = await seedPost(env, { id: 'window-30d', createdAt: new Date(now - 30 * 24 * 60 * 60 * 1000) })

      const result = await getFeed(env, undefined, { mode: 'top', window: 'all' })
      const ids = result.map((f) => f.post.id)
      expect(ids).toContain(h1)
      expect(ids).toContain(d3)
      expect(ids).toContain(d30)
    })

    it('window: "day" excludes posts older than 24h', async () => {
      const now = Date.now()
      const h1 = await seedPost(env, { id: 'daywin-1h', createdAt: new Date(now - 60 * 60 * 1000) })
      const d3 = await seedPost(env, { id: 'daywin-3d', createdAt: new Date(now - 3 * 24 * 60 * 60 * 1000) })
      const d30 = await seedPost(env, { id: 'daywin-30d', createdAt: new Date(now - 30 * 24 * 60 * 60 * 1000) })

      const result = await getFeed(env, undefined, { mode: 'top', window: 'day' })
      const ids = result.map((f) => f.post.id)
      expect(ids).toContain(h1)
      expect(ids).not.toContain(d3)
      expect(ids).not.toContain(d30)
    })

    it('window: "week" includes up to 7d, excludes older', async () => {
      const now = Date.now()
      const h1 = await seedPost(env, { id: 'weekwin-1h', createdAt: new Date(now - 60 * 60 * 1000) })
      const d3 = await seedPost(env, { id: 'weekwin-3d', createdAt: new Date(now - 3 * 24 * 60 * 60 * 1000) })
      const d30 = await seedPost(env, { id: 'weekwin-30d', createdAt: new Date(now - 30 * 24 * 60 * 60 * 1000) })

      const result = await getFeed(env, undefined, { mode: 'top', window: 'week' })
      const ids = result.map((f) => f.post.id)
      expect(ids).toContain(h1)
      expect(ids).toContain(d3)
      expect(ids).not.toContain(d30)
    })

    it('window: "day" orders by score DESC among posts in window', async () => {
      const now = Date.now()
      const low = await seedPost(env, { id: 'dayord-low', createdAt: new Date(now - 30 * 60 * 1000) })
      const high = await seedPost(env, { id: 'dayord-high', createdAt: new Date(now - 60 * 60 * 1000) })
      await seedVote(env, { postId: high, voterId: 'v1', value: 1 })
      await seedVote(env, { postId: high, voterId: 'v2', value: 1 })

      const result = await getFeed(env, undefined, { mode: 'top', window: 'day' })
      const ids = result.map((f) => f.post.id)
      expect(ids.indexOf(high)).toBeLessThan(ids.indexOf(low))
    })
  })

  describe('ordering and rank derivation', () => {
    it('orders by (score DESC, createdAt DESC, posts.id DESC) and assigns rank 1..N', async () => {
      // Three posts: high score wins regardless of age; among equal-score
      // posts, newer wins; among equal score+createdAt, desc(posts.id) wins.
      const high = await seedPost(env, { id: 'post-id-high', createdAt: ms(1000) })
      const newerLowScore = await seedPost(env, {
        id: 'post-id-newer-low',
        createdAt: ms(3000),
      })
      const olderLowScore = await seedPost(env, {
        id: 'post-id-older-low',
        createdAt: ms(2000),
      })
      await seedVote(env, { postId: high, voterId: 'v1', value: 1 })
      await seedVote(env, { postId: high, voterId: 'v2', value: 1 })

      const feed = await getFeed(env)
      expect(feed.map((f) => f.post.id)).toEqual([
        high,
        newerLowScore,
        olderLowScore,
      ])
      expect(feed.map((f) => f.rank)).toEqual([1, 2, 3])
    })

    it('tie-breaker: equal score and createdAt resolve to desc(posts.id), stable across calls', async () => {
      // The two posts are score=0, identical createdAt - only id differs.
      // desc(posts.id) means 'zzzz' sorts before 'aaaa'.
      const a = await seedPost(env, { id: 'aaaa', createdAt: ms(5000) })
      const z = await seedPost(env, { id: 'zzzz', createdAt: ms(5000) })

      const first = await getFeed(env)
      const second = await getFeed(env)

      expect(first.map((f) => f.post.id)).toEqual([z, a])
      // [LAW:one-source-of-truth] Two calls of the same query against the
      // same data must agree on order, including rank assignments.
      expect(first.map((f) => f.post.id)).toEqual(second.map((f) => f.post.id))
      expect(first.map((f) => f.rank)).toEqual(second.map((f) => f.rank))
    })
  })

  describe('aggregate bounding (PR #36)', () => {
    it('counts votes on a visible post even when many other posts exist', async () => {
      // 25 posts; the target gets +5 votes. The point of the bound is to
      // narrow the SUM scan to the visible set without dropping any of the
      // target's own votes. Verifies that the inArray-bounded subquery does
      // not over-filter.
      const target = await seedPost(env, {
        id: 'post-bounded-target',
        createdAt: ms(10_000),
      })
      for (let i = 0; i < 24; i++) {
        await seedPost(env, {
          id: `post-bounded-other-${i.toString().padStart(2, '0')}`,
          createdAt: ms(1000 + i),
        })
      }
      for (let i = 0; i < 5; i++) {
        await seedVote(env, {
          postId: target,
          voterId: `voter-${i}`,
          value: 1,
        })
      }

      const feed = await getFeed(env)
      const item = feed.find((f) => f.post.id === target)
      expect(item?.score).toBe(5)
    })

    it('counts only the target posts comments - comments on other posts do not leak in', async () => {
      const target = await seedPost(env, {
        id: 'post-comments-target',
        createdAt: ms(10_000),
      })
      const distractor = await seedPost(env, {
        id: 'post-comments-distractor',
        createdAt: ms(5_000),
      })
      await seedComment(env, { id: 'tc1', postId: target })
      await seedComment(env, { id: 'tc2', postId: target })
      await seedComment(env, { id: 'dc1', postId: distractor })
      await seedComment(env, { id: 'dc2', postId: distractor })
      await seedComment(env, { id: 'dc3', postId: distractor })

      const feed = await getFeed(env)
      expect(feed.find((f) => f.post.id === target)?.commentCount).toBe(2)
      expect(feed.find((f) => f.post.id === distractor)?.commentCount).toBe(3)
    })
  })

  describe('GenerationStatus arms', () => {
    it('round-trips a pending status with queuedAt', async () => {
      const queuedAt = ms(7000)
      const id = await seedPost(env, {
        id: 'post-pending',
        content: { kind: 'generation', status: { kind: 'pending', queuedAt } },
      })
      const [item] = await getFeed(env)
      expect(item.post.id).toBe(id)
      if (item.post.content.kind !== 'generation') throw new Error('expected generation content')
      expect(item.post.content.status).toEqual({ kind: 'pending', queuedAt })
    })

    it('round-trips a running status with startedAt', async () => {
      const startedAt = ms(7500)
      await seedPost(env, {
        id: 'post-running',
        content: { kind: 'generation', status: { kind: 'running', startedAt } },
      })
      const [item] = await getFeed(env)
      if (item.post.content.kind !== 'generation') throw new Error('expected generation content')
      expect(item.post.content.status).toEqual({ kind: 'running', startedAt })
    })

    it('round-trips a failed status with reason and failedAt', async () => {
      const failedAt = ms(8000)
      await seedPost(env, {
        id: 'post-failed',
        content: {
          kind: 'generation',
          status: { kind: 'failed', reason: 'provider 500', failedAt },
        },
      })
      const [item] = await getFeed(env)
      if (item.post.content.kind !== 'generation') throw new Error('expected generation content')
      expect(item.post.content.status).toEqual({
        kind: 'failed',
        reason: 'provider 500',
        failedAt,
      })
    })
  })

  describe('content discriminator', () => {
    it('round-trips an upload post with its asset Media', async () => {
      const asset = {
        kind: 'image' as const,
        url: '/media/upload-key',
        w: 800,
        h: 600,
      }
      const id = await seedPost(env, {
        id: 'post-upload',
        content: { kind: 'upload', asset },
      })

      const [item] = await getFeed(env)
      expect(item.post.id).toBe(id)
      if (item.post.content.kind !== 'upload') throw new Error('expected upload content')
      expect(item.post.content.asset).toEqual(asset)
    })

    it('round-trips a found post with url + title (no description, no thumbnail)', async () => {
      const id = await seedPost(env, {
        id: 'post-found-minimal',
        content: {
          kind: 'found',
          url: 'https://civitai.com/images/123',
          title: 'a found slop image',
        },
      })

      const [item] = await getFeed(env)
      expect(item.post.id).toBe(id)
      if (item.post.content.kind !== 'found') throw new Error('expected found content')
      expect(item.post.content.url).toBe('https://civitai.com/images/123')
      expect(item.post.content.title).toBe('a found slop image')
      expect(item.post.content.description).toBeUndefined()
      expect(item.post.content.thumbnail).toBeUndefined()
    })

    it('round-trips a found post with description and thumbnail Media', async () => {
      const thumbnail = {
        kind: 'image' as const,
        url: '/media/thumb-key',
        w: 256,
        h: 256,
        alt: 'thumbnail',
      }
      await seedPost(env, {
        id: 'post-found-full',
        content: {
          kind: 'found',
          url: 'https://lexica.art/prompt/abc',
          title: 'a discovered prompt',
          description: 'a long-ish description that the discovery agent scraped',
          thumbnail,
        },
      })

      const [item] = await getFeed(env)
      if (item.post.content.kind !== 'found') throw new Error('expected found content')
      expect(item.post.content.url).toBe('https://lexica.art/prompt/abc')
      expect(item.post.content.title).toBe('a discovered prompt')
      expect(item.post.content.description).toBe(
        'a long-ish description that the discovery agent scraped',
      )
      expect(item.post.content.thumbnail).toEqual(thumbnail)
    })

    it('found posts participate in scoring and ranking alongside generations', async () => {
      const foundId = await seedPost(env, {
        id: 'post-found-ranked',
        createdAt: ms(1000),
        content: {
          kind: 'found',
          url: 'https://example.com/x',
          title: 'found',
        },
      })
      const genId = await seedPost(env, { id: 'post-gen-ranked', createdAt: ms(2000) })
      await seedVote(env, { postId: foundId, voterId: 'v1', value: 1 })
      await seedVote(env, { postId: foundId, voterId: 'v2', value: 1 })

      const feed = await getFeed(env)
      // found post has score 2, generation has 0 — found wins ranking.
      expect(feed.map((f) => f.post.id)).toEqual([foundId, genId])
      expect(feed[0].rank).toBe(1)
      expect(feed[0].score).toBe(2)
    })

    it('round-trips a generation posts full recipe including parentId', async () => {
      const parent = await seedPost(env, { id: 'post-parent', createdAt: ms(1000) })
      const child = await seedPost(env, {
        id: 'post-child',
        createdAt: ms(2000),
        content: {
          kind: 'generation',
          styleFamily: 'cyberpunk-neon',
          aspectRatio: '16:9',
          subject: {
            subjectTemplate: 'T01',
            slots: { animal: 'iguana', profession: 'notary' },
          },
          providerId: 'replicate-ideogram',
          providerVersion: '2.0',
          params: { prompt: 'an iguana notary', seed: 42 },
          parentId: parent,
        },
      })

      const item = (await getFeed(env)).find((f) => f.post.id === child)
      if (!item || item.post.content.kind !== 'generation') {
        throw new Error('expected child generation in feed')
      }
      const recipe = item.post.content.recipe
      expect(recipe.providerId).toBe(ProviderId('replicate-ideogram'))
      expect(recipe.providerVersion).toBe('2.0')
      expect(recipe.styleFamily).toBe('cyberpunk-neon')
      expect(recipe.aspectRatio).toBe('16:9')
      expect(recipe.subject).toEqual({
        subjectTemplate: 'T01',
        slots: { animal: 'iguana', profession: 'notary' },
      })
      expect(recipe.params).toEqual({ prompt: 'an iguana notary', seed: 42 })
      expect(recipe.parentId).toBe(parent)
    })
  })

  describe('origin reconstruction (Content.kind -> Origin arm)', () => {
    it('reconstructs a generation as an authored origin with a persona author', async () => {
      // [LAW:types-are-the-program] Content.kind is the authoritative discriminator:
      // a generation reconstructs to the `authored` arm, author always a persona.
      const origin: Origin = {
        kind: 'authored',
        author: { kind: 'agent', agentId: AgentId('firehose-cron-v1') },
      }
      await seedPost(env, { id: 'post-authored', origin })

      const [item] = await getFeed(env)
      expect(item.post.origin).toEqual({
        kind: 'authored',
        author: { kind: 'agent', agentId: 'firehose-cron-v1' },
      })
    })

    it('reconstructs the legacy { actor } shape by content kind', async () => {
      // The pre-attribution shape stored a single `actor`. The reader maps it to the
      // arm chosen by Content.kind — here a generation → authored author — so old rows
      // keep rendering without a data migration of the cleanly-mappable majority.
      const legacy = { actor: { kind: 'agent', agentId: 'firehose-cron-v1' } } as unknown as Origin
      await seedPost(env, { id: 'post-legacy', origin: legacy })

      const [item] = await getFeed(env)
      expect(item.post.origin).toEqual({
        kind: 'authored',
        author: { kind: 'agent', agentId: 'firehose-cron-v1' },
      })
    })

    it('preserves the human breeder modifier on an authored slop', async () => {
      const origin: Origin = {
        kind: 'authored',
        author: { kind: 'agent', agentId: AgentId('firehose-cron-v1') },
        human: { role: 'breeder', by: { kind: 'anon', label: 'anon-6a6255' } },
      }
      await seedPost(env, { id: 'post-bred', origin })

      const [item] = await getFeed(env)
      expect(item.post.origin).toEqual({
        kind: 'authored',
        author: { kind: 'agent', agentId: 'firehose-cron-v1' },
        human: { role: 'breeder', by: { kind: 'anon', label: 'anon-6a6255' } },
      })
    })

    it('reconstructs a found slop as a finder origin (no author)', async () => {
      const origin: Origin = {
        kind: 'found',
        finder: { kind: 'anon', label: 'anon-finder' },
      }
      await seedPost(env, { id: 'post-found', origin, content: { kind: 'found' } })

      const [item] = await getFeed(env)
      expect(item.post.origin).toEqual({
        kind: 'found',
        finder: { kind: 'anon', label: 'anon-finder' },
      })
    })

    it('fails loud when a generation has a non-persona author (storage violation)', async () => {
      // A human in the author slot is unrepresentable in the domain; if storage holds
      // one anyway, the read boundary throws rather than laundering it.
      const illegal = { actor: { kind: 'anon', label: 'anon-imposter' } } as unknown as Origin
      await seedPost(env, { id: 'post-illegal-author', origin: illegal })

      await expect(getFeed(env)).rejects.toThrow(/non-persona author/)
    })
  })
})

describe('app/db/feed.ts - getFeedItemById', () => {
  it('returns null when the id does not match any post', async () => {
    const result = await getFeedItemById(env, PostId('does-not-exist'))
    expect(result).toBeNull()
  })

  it('returns the RenderablePost shape (no rank field) on hit', async () => {
    const id = await seedPost(env, { id: 'post-permalink-shape' })
    await seedVote(env, { postId: id, voterId: 'voter-a', value: 1 })
    await seedComment(env, { id: 'pc1', postId: id })

    const result = await getFeedItemById(env, id, 'voter-a')

    expect(result).not.toBeNull()
    const r = result as RenderablePost
    expect(r.post.id).toBe(id)
    expect(r.score).toBe(1)
    expect(r.commentCount).toBe(1)
    expect(r.myVote).toBe(1)
    // [LAW:behavior-not-structure] Even though the type RenderablePost forbids
    // `rank`, assert it explicitly at runtime so a future change that re-adds
    // rank to RenderablePost gets caught by behavior, not just by types.
    expect(r).not.toHaveProperty('rank')
  })

  it('aggregates match getFeed for the same post', async () => {
    // [LAW:one-source-of-truth] voteScoreSubquery is the single source for
    // SUM(votes.value); the two readers must compute the same score per post.
    const id = await seedPost(env, { id: 'post-aggregate-consistency' })
    await seedVote(env, { postId: id, voterId: 'voter-a', value: 1 })
    await seedVote(env, { postId: id, voterId: 'voter-b', value: 1 })
    await seedVote(env, { postId: id, voterId: 'voter-c', value: -1 })
    await seedComment(env, { id: 'cc1', postId: id })

    const feedItem = (await getFeed(env, 'voter-a')).find((f) => f.post.id === id) as FeedItem
    const permalinkItem = (await getFeedItemById(env, id, 'voter-a')) as RenderablePost
    expect(permalinkItem.score).toBe(feedItem.score)
    expect(permalinkItem.commentCount).toBe(feedItem.commentCount)
    expect(permalinkItem.myVote).toBe(feedItem.myVote)
    expect(permalinkItem.post).toEqual(feedItem.post)
  })
})

describe('app/db/feed.ts - getPostById', () => {
  it('returns null when the id does not match any post', async () => {
    const result = await getPostById(env, PostId('does-not-exist'))
    expect(result).toBeNull()
  })

  it('returns the bare Post shape (no score / myVote / commentCount) for a generation', async () => {
    const id = await seedPost(env, {
      id: 'post-bare-generation',
      content: {
        kind: 'generation',
        subject: {
          subjectTemplate: 'T01',
          slots: { animal: 'iguana', profession: 'notary' },
        },
      },
    })
    // Add aggregates that should NOT leak into getPostById's result.
    await seedVote(env, { postId: id, voterId: 'voter-a', value: 1 })
    await seedComment(env, { id: 'bc1', postId: id })

    const result = await getPostById(env, id)

    expect(result).not.toBeNull()
    expect(result!.id).toBe(id)
    if (result!.content.kind !== 'generation') throw new Error('expected generation')
    expect(result!.content.recipe.subject).toEqual({
      subjectTemplate: 'T01',
      slots: { animal: 'iguana', profession: 'notary' },
    })
    // [LAW:behavior-not-structure] getPostById's contract is "no aggregates"
    // - Post type doesn't carry score/myVote/commentCount, and the runtime
    // shape must not silently include them either.
    expect(result).not.toHaveProperty('score')
    expect(result).not.toHaveProperty('myVote')
    expect(result).not.toHaveProperty('commentCount')
    expect(result).not.toHaveProperty('rank')
  })

  it('returns an upload post with its asset', async () => {
    const asset = {
      kind: 'image' as const,
      url: '/media/upload-bare',
      w: 400,
      h: 400,
    }
    const id = await seedPost(env, {
      id: 'post-bare-upload',
      content: { kind: 'upload', asset },
    })

    const result = await getPostById(env, id)
    if (!result || result.content.kind !== 'upload') {
      throw new Error('expected upload')
    }
    expect(result.content.asset).toEqual(asset)
  })

  // [LAW:behavior-not-structure] The read-side dual of posts.test.ts's wish
  // persistence test: that proves createPost WRITES the wish to the generations
  // row; this proves the storage→domain reader RECONSTRUCTS it through a real D1
  // round-trip. The mapping `wish: g.wish ?? undefined` is an optional field — a
  // drift that drops it from the projection or maps a stored wish to undefined
  // compiles clean, so only a behavioral test catches it. Both halves of the
  // optional are asserted: a stored wish round-trips verbatim, and a non-Well
  // generation (NULL column) reconstructs to undefined, never a laundered null.
  it('round-trips a Well-born generation wish verbatim', async () => {
    const wish = 'a lighthouse at the end of the world'
    const id = await seedPost(env, {
      id: 'post-with-wish',
      content: { kind: 'generation', wish },
    })

    const result = await getPostById(env, id)
    if (!result || result.content.kind !== 'generation') {
      throw new Error('expected generation')
    }
    expect(result.content.recipe.wish).toBe(wish)
  })

  it('reconstructs a wishless generation with recipe.wish undefined (NULL column)', async () => {
    const id = await seedPost(env, {
      id: 'post-without-wish',
      content: { kind: 'generation' },
    })

    const result = await getPostById(env, id)
    if (!result || result.content.kind !== 'generation') {
      throw new Error('expected generation')
    }
    // [LAW:no-defensive-null-guards] absence is undefined (a legal optional),
    // not null smuggled through — the field is genuinely absent.
    expect(result.content.recipe.wish).toBeUndefined()
  })

  // The placard NAME round-trips through a real D1 read: createPost writes the
  // title column, the reader reconstructs Content.generation.title. A projection
  // that drops the field compiles clean, so only a behavioral round-trip catches it.
  it('round-trips an authored generation title verbatim', async () => {
    const title = "St. Brindle's Hallway"
    const id = await seedPost(env, {
      id: 'post-with-title',
      content: { kind: 'generation', title, params: { prompt: 'a wholly different prompt string' } },
    })

    const result = await getPostById(env, id)
    if (!result || result.content.kind !== 'generation') {
      throw new Error('expected generation')
    }
    expect(result.content.title).toBe(title)
    // The title is the piece's name, a field distinct from the raw prompt.
    const prompt = (result.content.recipe.params as { prompt: string }).prompt
    expect(result.content.title).not.toBe(prompt)
  })

  // [LAW:no-silent-fallbacks] A legacy row (empty-string sentinel, written before
  // the title column existed) reconstructs to the deterministic placard derived from
  // its subject — non-empty, distinct from the prompt — never a silent blank.
  it('derives a non-empty placard for a legacy generation with no stored title', async () => {
    const subject = { subjectTemplate: 'T01' as const, slots: { animal: 'heron', profession: 'notary' } }
    const id = await seedPost(env, {
      id: 'post-legacy-no-title',
      content: { kind: 'generation', title: '', subject },
    })

    const result = await getPostById(env, id)
    if (!result || result.content.kind !== 'generation') {
      throw new Error('expected generation')
    }
    expect(result.content.title.length).toBeGreaterThan(0)
    expect(result.content.title).toBe(fallbackTitle(subject))
  })

  // A whitespace-only title is as blank as '' on the card, so it must take the
  // fallback too — the invariant is a *visible* name, not merely a non-empty string.
  it('derives a placard for a whitespace-only stored title', async () => {
    const subject = { subjectTemplate: 'T01' as const, slots: { animal: 'crane', profession: 'cartographer' } }
    const id = await seedPost(env, {
      id: 'post-whitespace-title',
      content: { kind: 'generation', title: '   ', subject },
    })

    const result = await getPostById(env, id)
    if (!result || result.content.kind !== 'generation') {
      throw new Error('expected generation')
    }
    expect(result.content.title).toBe(fallbackTitle(subject))
  })

  it('returns a found post with its url, title, description, and thumbnail', async () => {
    const thumbnail = {
      kind: 'image' as const,
      url: '/media/found-bare-thumb',
      w: 320,
      h: 200,
    }
    const id = await seedPost(env, {
      id: 'post-bare-found',
      content: {
        kind: 'found',
        url: 'https://huggingface.co/spaces/foo/bar',
        title: 'a HF space',
        description: 'optional description',
        thumbnail,
      },
    })

    const result = await getPostById(env, id)
    if (!result || result.content.kind !== 'found') {
      throw new Error('expected found')
    }
    expect(result.content.url).toBe('https://huggingface.co/spaces/foo/bar')
    expect(result.content.title).toBe('a HF space')
    expect(result.content.description).toBe('optional description')
    expect(result.content.thumbnail).toEqual(thumbnail)
  })
})

// [LAW:behavior-not-structure] These pin the verdict CONTRACT: given seeded votes
// with reasoning by a known critic, the feed item carries that critic's displayName
// and verdict text; and the documented selection/absence rules hold. Blind to the
// fetchVerdicts decomposition (window rank, trim predicate) — a refactor that keeps
// the contract intact must not require editing these.
describe('app/db/feed.ts - verdict', () => {
  it('carries the critic displayName + reasoning for a post with an agent-reasoned vote', async () => {
    await seedCritic('agent:vivian', 'St. Vivian')
    const id = await seedPost(env, { id: 'post-verdict', createdAt: ms(1000) })
    await seedVote(env, {
      postId: id,
      voterId: 'agent:vivian',
      value: 1,
      reasoning: 'Four steps and it still found the void. Devastating. I wept.',
    })

    const [item] = await getFeed(env)
    expect(item.verdict).toEqual({
      critic: 'St. Vivian',
      text: 'Four steps and it still found the void. Devastating. I wept.',
    })
  })

  it('leaves verdict undefined when no vote carries reasoning', async () => {
    await seedPost(env, { id: 'post-no-verdict', createdAt: ms(1000) })
    // A human anon vote (no reasoning, no persona row) must not mint a verdict.
    await seedVote(env, { postId: PostId('post-no-verdict'), voterId: 'anon-cookie', value: 1 })

    const [item] = await getFeed(env)
    expect(item.verdict).toBeUndefined()
  })

  it('never mints an empty-string verdict from a blank/whitespace reasoning', async () => {
    await seedCritic('agent:blankcritic', 'The Blank')
    const id = await seedPost(env, { id: 'post-blank-verdict', createdAt: ms(1000) })
    // [LAW:no-silent-fallbacks] A whitespace-only reasoning is excluded by the trim
    // predicate — it is no verdict, not an empty one.
    await seedVote(env, { postId: id, voterId: 'agent:blankcritic', value: -1, reasoning: '   ' })

    const [item] = await getFeed(env)
    expect(item.verdict).toBeUndefined()
  })

  it('selects the MOST RECENT meaningful critic line when several exist', async () => {
    await seedCritic('agent:vivian', 'St. Vivian')
    await seedCritic('agent:gremlin', 'The Gremlin')
    const id = await seedPost(env, { id: 'post-multi-verdict', createdAt: ms(1000) })
    await seedVote(env, {
      postId: id,
      voterId: 'agent:vivian',
      value: 1,
      reasoning: 'An older blessing.',
      createdAt: ms(2000),
    })
    await seedVote(env, {
      postId: id,
      voterId: 'agent:gremlin',
      value: -1,
      reasoning: 'Mid. Aggressively mid. Buried.',
      createdAt: ms(3000),
    })

    const [item] = await getFeed(env)
    expect(item.verdict).toEqual({ critic: 'The Gremlin', text: 'Mid. Aggressively mid. Buried.' })
  })

  it('surfaces an older meaningful line when the newest vote has blank reasoning', async () => {
    await seedCritic('agent:vivian', 'St. Vivian')
    await seedCritic('agent:gremlin', 'The Gremlin')
    const id = await seedPost(env, { id: 'post-shadow-verdict', createdAt: ms(1000) })
    await seedVote(env, {
      postId: id,
      voterId: 'agent:vivian',
      value: 1,
      reasoning: 'The sixth finger reaches. Canonized.',
      createdAt: ms(2000),
    })
    // Newer, but blank — must not shadow the real verdict into silence.
    await seedVote(env, {
      postId: id,
      voterId: 'agent:gremlin',
      value: -1,
      reasoning: '  ',
      createdAt: ms(3000),
    })

    const [item] = await getFeed(env)
    expect(item.verdict).toEqual({
      critic: 'St. Vivian',
      text: 'The sixth finger reaches. Canonized.',
    })
  })

  it('trims surrounding whitespace from the stored reasoning', async () => {
    await seedCritic('agent:vivian', 'St. Vivian')
    const id = await seedPost(env, { id: 'post-trim-verdict', createdAt: ms(1000) })
    await seedVote(env, {
      postId: id,
      voterId: 'agent:vivian',
      value: 1,
      reasoning: '   Blessed be the cursed.   ',
    })

    const [item] = await getFeed(env)
    expect(item.verdict?.text).toBe('Blessed be the cursed.')
  })

  it('excludes a critic whose displayName is blank — no empty byline', async () => {
    // [LAW:types-are-the-program] A verdict has no fallback byline, so a blank critic
    // name is no verdict at all (the mirror of a blank reasoning), never a `— ` byline.
    await seedCritic('agent:nameless', '   ')
    const id = await seedPost(env, { id: 'post-nameless-critic', createdAt: ms(1000) })
    await seedVote(env, {
      postId: id,
      voterId: 'agent:nameless',
      value: 1,
      reasoning: 'A line with no one to sign it.',
    })

    const [item] = await getFeed(env)
    expect(item.verdict).toBeUndefined()
  })

  it('surfaces an older well-named critic when the newest critic is blank-named', async () => {
    await seedCritic('agent:vivian', 'St. Vivian')
    await seedCritic('agent:nameless', '  ')
    const id = await seedPost(env, { id: 'post-name-shadow', createdAt: ms(1000) })
    await seedVote(env, {
      postId: id,
      voterId: 'agent:vivian',
      value: 1,
      reasoning: 'A blessing that keeps its name.',
      createdAt: ms(2000),
    })
    await seedVote(env, {
      postId: id,
      voterId: 'agent:nameless',
      value: -1,
      reasoning: 'Newer, but the critic is nameless.',
      createdAt: ms(3000),
    })

    const [item] = await getFeed(env)
    expect(item.verdict).toEqual({
      critic: 'St. Vivian',
      text: 'A blessing that keeps its name.',
    })
  })

  it('trims surrounding whitespace from the critic byline', async () => {
    await seedCritic('agent:padded', '  The Gremlin  ')
    const id = await seedPost(env, { id: 'post-padded-byline', createdAt: ms(1000) })
    await seedVote(env, {
      postId: id,
      voterId: 'agent:padded',
      value: -1,
      reasoning: 'Buried.',
    })

    const [item] = await getFeed(env)
    expect(item.verdict?.critic).toBe('The Gremlin')
  })

  it('attaches the verdict on the permalink reader (getFeedItemById) too', async () => {
    await seedCritic('agent:gremlin', 'The Gremlin')
    const id = await seedPost(env, { id: 'post-permalink-verdict', createdAt: ms(1000) })
    await seedVote(env, {
      postId: id,
      voterId: 'agent:gremlin',
      value: -1,
      reasoning: 'Another forest. The trees won. Buried.',
    })

    const item = await getFeedItemById(env, id)
    expect(item?.verdict).toEqual({
      critic: 'The Gremlin',
      text: 'Another forest. The trees won. Buried.',
    })
  })
})
