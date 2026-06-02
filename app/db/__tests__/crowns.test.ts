// [LAW:behavior-not-structure] Pins the crown record against a real D1 isolate: a
// crowning is persisted ONCE (the day's slot is unique — a re-fire is an idempotent
// no-op); the candidates the rite weighs are the vote extremes that already exist
// (net score + blessing/burial counts, succeeded generations only); and the eternal
// mark on a feed card is DERIVED from the crown record alone (markFor(lens)), with
// no is_crowned column anywhere — seed a crown, the feed shows its mark.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { db } from '~/db/client'
import { crowns } from '~/db/schema'
import {
  crowningsForPosts,
  gatherCandidates,
  recordCrowning,
} from '~/db/crowns'
import { getFeed } from '~/db/feed'
import { AgentId, PostId } from '~/lib/domain'
import { spoke } from '~/lib/voice'
import { seedPost, seedVote } from './helpers'

const DECREE = spoke('A test decree.')

async function seedProprietor(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO personas
       (agent_id, handle, display_name, role, persona_prompt, model_id, config_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind('agent:test-host', 'test-host', 'The Test Host', 'host', 'p', 'm', '{}', 0)
    .run()
}

describe('recordCrowning — one ceremony per day, idempotent', () => {
  it('records a crown and a same-day re-fire is a no-op', async () => {
    const post = await seedPost(env)
    const first = await recordCrowning(env, {
      postId: post,
      riteDay: '2026-05-17',
      lens: 'saint',
      presiding: AgentId('agent:test-host'),
      decree: DECREE,
    })
    expect(first.recorded).toBe(true)

    const second = await recordCrowning(env, {
      postId: post,
      riteDay: '2026-05-17',
      lens: 'saint',
      presiding: AgentId('agent:test-host'),
      decree: DECREE,
    })
    expect(second).toEqual({ recorded: false, reason: 'already_crowned_today' })

    const rows = await db(env).select().from(crowns)
    expect(rows).toHaveLength(1)
  })
})

describe('gatherCandidates — reads the votes that exist', () => {
  it('aggregates net score and blessing/burial counts per judged generation', async () => {
    const post = await seedPost(env)
    await seedVote(env, { postId: post, voterId: 'v1', value: 1 })
    await seedVote(env, { postId: post, voterId: 'v2', value: 1 })
    await seedVote(env, { postId: post, voterId: 'v3', value: 1 })
    await seedVote(env, { postId: post, voterId: 'v4', value: -1 })

    const candidates = await gatherCandidates(env)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      postId: post,
      score: 2,
      blessings: 3,
      burials: 1,
    })
  })

  it('excludes posts the city never voted on', async () => {
    await seedPost(env) // a generation with no votes
    expect(await gatherCandidates(env)).toHaveLength(0)
  })

  it('excludes generations that did not succeed', async () => {
    const failed = await seedPost(env, {
      content: {
        kind: 'generation',
        status: { kind: 'failed', reason: 'boom', failedAt: new Date('2026-01-01') },
      },
    })
    await seedVote(env, { postId: failed, voterId: 'v1', value: 1 })
    expect(await gatherCandidates(env)).toHaveLength(0)
  })
})

describe('crowningsForPosts — the eternal mark derives from the record', () => {
  it('derives the mark from the lens and resolves the presiding citizen', async () => {
    await seedProprietor()
    const post = await seedPost(env)
    await recordCrowning(env, {
      postId: post,
      riteDay: '2026-05-17',
      lens: 'villain',
      presiding: AgentId('agent:test-host'),
      decree: DECREE,
    })

    const map = await crowningsForPosts(db(env), [post])
    const crowning = map.get(post)
    expect(crowning).toEqual({
      lens: 'villain',
      mark: 'magenta',
      riteDay: '2026-05-17',
      presiding: { handle: 'test-host', displayName: 'The Test Host' },
    })
  })

  it('falls back to the agentId label when the presiding persona is absent', async () => {
    const post = await seedPost(env)
    await recordCrowning(env, {
      postId: post,
      riteDay: '2026-05-17',
      lens: 'relic',
      presiding: AgentId('agent:retired-ghost'),
      decree: DECREE,
    })
    const crowning = (await crowningsForPosts(db(env), [post])).get(post)
    expect(crowning?.mark).toBe('bronze')
    expect(crowning?.presiding).toEqual({ handle: null, displayName: 'agent:retired-ghost' })
  })

  it('surfaces the LATEST crown when a post carries more than one', async () => {
    const post = await seedPost(env)
    await recordCrowning(env, {
      postId: post,
      riteDay: '2026-05-10',
      lens: 'saint',
      presiding: AgentId('agent:x'),
      decree: DECREE,
    })
    await recordCrowning(env, {
      postId: post,
      riteDay: '2026-05-17',
      lens: 'miracle',
      presiding: AgentId('agent:x'),
      decree: DECREE,
    })
    const crowning = (await crowningsForPosts(db(env), [post])).get(post)
    expect(crowning?.lens).toBe('miracle')
    expect(crowning?.mark).toBe('bone')
    expect(crowning?.riteDay).toBe('2026-05-17')
  })
})

describe('the feed shows the mark from the crown record alone', () => {
  it('a crowned post renders its crowning in the normal feed', async () => {
    const crownedId = crypto.randomUUID()
    await seedPost(env, { id: crownedId })
    const plain = await seedPost(env)
    await recordCrowning(env, {
      postId: PostId(crownedId),
      riteDay: '2026-05-17',
      lens: 'saint',
      presiding: AgentId('agent:slop-purist'),
      decree: DECREE,
    })

    const feed = await getFeed(env)
    const crowned = feed.find((f) => f.post.id === crownedId)
    const uncrowned = feed.find((f) => f.post.id === plain)

    expect(crowned?.crowning).toMatchObject({ lens: 'saint', mark: 'gold', riteDay: '2026-05-17' })
    // [LAW:dataflow-not-control-flow] An uncrowned post has NO crowning — absence is
    // the discriminator, not a stored flag.
    expect(uncrowned?.crowning).toBeUndefined()
  })
})
