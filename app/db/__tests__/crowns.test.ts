// [LAW:behavior-not-structure] Pins the crown record against a real D1 isolate: a
// crowning is persisted ONCE (the day's slot is unique — a re-fire is an idempotent
// no-op); the candidates the rite weighs are gathered per BALLOT (a sole ballot
// resolves only the presiding citizen's own votes; acclaim takes every judged slop);
// a stored decree is validated at the read boundary; and the eternal mark on a feed
// card is DERIVED from the crown record alone (markFor(lens)), with no is_crowned
// column anywhere — seed a crown, the feed shows its mark.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { db } from '~/db/client'
import { crowns } from '~/db/schema'
import {
  crowningForDay,
  crowningsForPosts,
  gatherCandidates,
  recordCrowning,
} from '~/db/crowns'
import { getFeed } from '~/db/feed'
import { AgentId, PostId } from '~/lib/domain'
import type { RiteBallot } from '~/lib/rite'
import { spoke } from '~/lib/voice'
import { seedPost, seedVote } from './helpers'

const DECREE = spoke('A test decree.')
const VIVIAN = AgentId('agent:slop-purist')

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

    // A re-fire records nothing new and returns the crown that IS there (its stored
    // decree + post), not a fresh re-election.
    const second = await recordCrowning(env, {
      postId: post,
      riteDay: '2026-05-17',
      lens: 'saint',
      presiding: AgentId('agent:test-host'),
      decree: DECREE,
    })
    expect(second).toEqual({
      recorded: false,
      existing: { postId: post, lens: 'saint', decree: DECREE },
    })

    const rows = await db(env).select().from(crowns)
    expect(rows).toHaveLength(1)
  })
})

const SOLE_VIVIAN: RiteBallot = { kind: 'sole', citizen: VIVIAN, pole: 'blessed' }
const ACCLAIM: RiteBallot = { kind: 'acclaim' }

// A one-day window and times inside / before it.
const WINDOW = { sinceMs: 1778900400000, untilMs: 1778986800000 }
const IN_WINDOW = new Date(WINDOW.sinceMs + 60 * 60 * 1000)
const BEFORE_WINDOW = new Date(WINDOW.sinceMs - 60 * 60 * 1000)

describe('gatherCandidates — the day’s ballot decides who nominates', () => {
  it('a sole ballot nominates ONLY the presiding citizen’s votes, with overall score', async () => {
    const blessed = await seedPost(env)
    await seedVote(env, { postId: blessed, voterId: 'agent:slop-purist', value: 1, createdAt: IN_WINDOW })
    await seedVote(env, { postId: blessed, voterId: 'v2', value: -1, createdAt: IN_WINDOW })
    // A post the city loves but Vivian never voted on — NOT a sole-ballot candidate.
    const popular = await seedPost(env)
    await seedVote(env, { postId: popular, voterId: 'a', value: 1, createdAt: IN_WINDOW })
    await seedVote(env, { postId: popular, voterId: 'b', value: 1, createdAt: IN_WINDOW })

    const candidates = await gatherCandidates(env, SOLE_VIVIAN, WINDOW)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toEqual({
      postId: blessed,
      overallScore: 0, // +1 (Vivian) −1 (v2)
      citizenVotes: { 'agent:slop-purist': 1 },
    })
  })

  it('an acclaim ballot takes every slop judged in the window with its whole-city score', async () => {
    const a = await seedPost(env)
    await seedVote(env, { postId: a, voterId: 'x', value: 1, createdAt: IN_WINDOW })
    await seedVote(env, { postId: a, voterId: 'y', value: 1, createdAt: IN_WINDOW })
    await seedPost(env) // no votes — not judged
    const candidates = await gatherCandidates(env, ACCLAIM, WINDOW)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toEqual({ postId: a, overallScore: 2, citizenVotes: {} })
  })

  it('reads only the DAY: votes cast before the window do not nominate', async () => {
    const stale = await seedPost(env)
    await seedVote(env, { postId: stale, voterId: 'agent:slop-purist', value: 1, createdAt: BEFORE_WINDOW })
    expect(await gatherCandidates(env, SOLE_VIVIAN, WINDOW)).toHaveLength(0)
    expect(await gatherCandidates(env, ACCLAIM, WINDOW)).toHaveLength(0)
  })

  it('excludes generations that did not succeed', async () => {
    const failed = await seedPost(env, {
      content: {
        kind: 'generation',
        status: { kind: 'failed', reason: 'boom', failedAt: new Date('2026-01-01') },
      },
    })
    await seedVote(env, { postId: failed, voterId: 'agent:slop-purist', value: 1, createdAt: IN_WINDOW })
    expect(await gatherCandidates(env, SOLE_VIVIAN, WINDOW)).toHaveLength(0)
    expect(await gatherCandidates(env, ACCLAIM, WINDOW)).toHaveLength(0)
  })
})

describe('crowningForDay — the stored decree is validated at the boundary', () => {
  it('round-trips a recorded crown’s decree', async () => {
    const post = await seedPost(env)
    await recordCrowning(env, {
      postId: post,
      riteDay: '2026-05-17',
      lens: 'saint',
      presiding: VIVIAN,
      decree: DECREE,
    })
    expect(await crowningForDay(env, '2026-05-17')).toEqual({
      postId: post,
      lens: 'saint',
      decree: DECREE,
    })
  })

  it('fails loud on a malformed decree_json (no silent null-cast)', async () => {
    const post = await seedPost(env)
    // A storage violation a raw write could produce: decree_json = the JSON literal null.
    await env.DB.prepare(
      `INSERT INTO crowns (id, post_id, rite_day, lens, presiding, decree_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind('crown:bad', post, '2026-05-18', 'saint', 'agent:slop-purist', 'null', 0)
      .run()
    await expect(crowningForDay(env, '2026-05-18')).rejects.toThrow(/valid Utterance/)
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
