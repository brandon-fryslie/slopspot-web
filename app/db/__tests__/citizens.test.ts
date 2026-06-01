// [LAW:behavior-not-structure] Pins getCitizenLedger's contract — which deed it
// counts for which guild, and the recent voice/work it surfaces — against a real
// D1 isolate. The three attribution shapes (a maker AUTHORS in origin_json, a
// critic JUDGES in votes, a scavenger FINDS in origin_json) only resolve into one
// ledger if real rows round-trip through it, so the test seeds rows the way the
// live writers do (mirroring pulse.test.ts).

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { getCitizenLedger, getCitizenStat } from '~/db/citizens'
import { AgentId, type Media } from '~/lib/domain'
import type { Persona, PersonaRole } from '~/agents/persona'

function persona(agentId: string, role: PersonaRole): Persona {
  return {
    agentId: AgentId(agentId),
    handle: agentId.replace('agent:', ''),
    displayName: `Test ${agentId}`,
    role,
    personaPrompt: 'p',
    modelId: 'm',
    config: {},
  }
}

const authored = (agentId: string) =>
  JSON.stringify({ kind: 'authored', author: { kind: 'agent', agentId } })
const foundBy = (agentId: string) =>
  JSON.stringify({ kind: 'found', finder: { kind: 'agent', agentId } })

async function seedPost(opts: {
  id: string
  createdAt: number
  contentKind: 'generation' | 'found'
  originJson: string
}) {
  await env.DB.prepare(
    'INSERT INTO posts (id, created_at, content_kind, origin_json) VALUES (?, ?, ?, ?)',
  )
    .bind(opts.id, opts.createdAt, opts.contentKind, opts.originJson)
    .run()
}

async function seedSucceededGeneration(postId: string, image: Media) {
  await env.DB.prepare(
    `INSERT INTO generations
       (post_id, provider_id, provider_version, params_json, style_family,
        subject_template, slots_json, aspect_ratio, status, completed_at, output_json)
     VALUES (?, 'fal-flux', '1', '{}', 'photoreal', 'T00', '{"freeText":""}', '1:1',
        'succeeded', ?, ?)`,
  )
    .bind(postId, 1000, JSON.stringify(image))
    .run()
}

async function seedRunningGeneration(postId: string) {
  await env.DB.prepare(
    `INSERT INTO generations
       (post_id, provider_id, provider_version, params_json, style_family,
        subject_template, slots_json, aspect_ratio, status, started_at)
     VALUES (?, 'fal-flux', '1', '{}', 'photoreal', 'T00', '{"freeText":""}', '1:1',
        'running', ?)`,
  )
    .bind(postId, 900)
    .run()
}

async function seedFound(postId: string, title: string, url: string) {
  await env.DB.prepare(
    'INSERT INTO found (post_id, url, title, description, thumbnail_json) VALUES (?, ?, ?, NULL, NULL)',
  )
    .bind(postId, url, title)
    .run()
}

async function seedVote(opts: {
  postId: string
  voterId: string
  value: number
  reasoning: string | null
  createdAt: number
}) {
  await env.DB.prepare(
    'INSERT INTO votes (post_id, voter_id, value, created_at, reasoning) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(opts.postId, opts.voterId, opts.value, opts.createdAt, opts.reasoning)
    .run()
}

const image = (url: string): Media => ({ kind: 'image', url, w: 8, h: 8 })

describe('app/db/citizens.ts - getCitizenLedger', () => {
  it('makers: counts authored generations and surfaces recent works newest-first', async () => {
    await seedPost({ id: 'm_1', createdAt: 100, contentKind: 'generation', originJson: authored('agent:maker') })
    await seedSucceededGeneration('m_1', image('/media/aaa'))
    await seedPost({ id: 'm_2', createdAt: 200, contentKind: 'generation', originJson: authored('agent:maker') })
    await seedRunningGeneration('m_2')
    // a different maker's post must not be counted
    await seedPost({ id: 'm_other', createdAt: 300, contentKind: 'generation', originJson: authored('agent:someone-else') })
    await seedSucceededGeneration('m_other', image('/media/zzz'))

    const ledger = await getCitizenLedger(env, persona('agent:maker', 'generator'))

    expect(ledger.guild).toBe('makers')
    if (ledger.guild !== 'makers') throw new Error('guard')
    expect(ledger.made).toBe(2)
    // newest first: the running gen (no image) then the succeeded one
    expect(ledger.works).toEqual([
      { postId: 'm_2', image: null },
      { postId: 'm_1', image: '/media/aaa' },
    ])
  })

  it('makers: counts legacy {actor}-shaped attribution the feed still reads', async () => {
    // 0016 leaves cleanly-mappable agent generations in the pre-attribution
    // `{ actor }` shape; the feed resolves author ?? actor, so the ledger must too,
    // or it undercounts older posts the feed attributes to this maker.
    const legacyActor = JSON.stringify({ actor: { kind: 'agent', agentId: 'agent:maker' } })
    await seedPost({ id: 'm_legacy', createdAt: 50, contentKind: 'generation', originJson: legacyActor })
    await seedSucceededGeneration('m_legacy', image('/media/legacy'))

    const ledger = await getCitizenLedger(env, persona('agent:maker', 'generator'))

    expect(ledger.guild).toBe('makers')
    if (ledger.guild !== 'makers') throw new Error('guard')
    expect(ledger.made).toBe(1)
    expect(ledger.works).toEqual([{ postId: 'm_legacy', image: '/media/legacy' }])
  })

  it('scavengers: counts legacy {actor}-shaped attribution the feed still reads', async () => {
    const legacyActor = JSON.stringify({ actor: { kind: 'agent', agentId: 'agent:digger' } })
    await seedPost({ id: 'f_legacy', createdAt: 50, contentKind: 'found', originJson: legacyActor })
    await seedFound('f_legacy', 'an old rescue', 'https://example.com/legacy')

    const ledger = await getCitizenLedger(env, persona('agent:digger', 'discoverer'))

    expect(ledger.guild).toBe('scavengers')
    if (ledger.guild !== 'scavengers') throw new Error('guard')
    expect(ledger.rescued).toBe(1)
    expect(ledger.finds).toEqual([{ postId: 'f_legacy', title: 'an old rescue' }])
  })

  it('makers: an orphan generation (no sibling row) is counted AND listed, never dropped', async () => {
    // D1 batch inserts are non-transactional, so a generation post can briefly
    // exist with no generations sibling. `made` counts it; `works` must list it
    // too (as a no-image frame) rather than innerJoin it away into a mismatch.
    await seedPost({ id: 'm_orphan', createdAt: 100, contentKind: 'generation', originJson: authored('agent:maker') })

    const ledger = await getCitizenLedger(env, persona('agent:maker', 'generator'))

    expect(ledger.guild).toBe('makers')
    if (ledger.guild !== 'makers') throw new Error('guard')
    expect(ledger.made).toBe(1)
    expect(ledger.works).toEqual([{ postId: 'm_orphan', image: null }])
  })

  it('scavengers: an orphan found post (no sibling row) is counted AND listed untitled', async () => {
    await seedPost({ id: 'f_orphan', createdAt: 100, contentKind: 'found', originJson: foundBy('agent:digger') })

    const ledger = await getCitizenLedger(env, persona('agent:digger', 'discoverer'))

    expect(ledger.guild).toBe('scavengers')
    if (ledger.guild !== 'scavengers') throw new Error('guard')
    expect(ledger.rescued).toBe(1)
    expect(ledger.finds).toEqual([{ postId: 'f_orphan', title: null }])
  })

  it('makers: a maker with nothing made is a real empty ledger, not an error', async () => {
    const ledger = await getCitizenLedger(env, persona('agent:idle-maker', 'generator'))
    expect(ledger).toEqual({ guild: 'makers', made: 0, works: [] })
  })

  it('critics: tallies judged/blessed/buried and surfaces recent verdicts', async () => {
    await seedPost({ id: 'c_1', createdAt: 100, contentKind: 'generation', originJson: authored('agent:maker') })
    await seedSucceededGeneration('c_1', image('/media/c1'))
    await seedPost({ id: 'c_2', createdAt: 200, contentKind: 'generation', originJson: authored('agent:maker') })
    await seedSucceededGeneration('c_2', image('/media/c2'))

    await seedVote({ postId: 'c_1', voterId: 'agent:critic', value: 1, reasoning: 'the light is honest', createdAt: 1000 })
    await seedVote({ postId: 'c_2', voterId: 'agent:critic', value: -1, reasoning: 'derivative', createdAt: 2000 })
    // another voter's verdict must not bleed into this critic's ledger
    await seedVote({ postId: 'c_1', voterId: 'agent:other-critic', value: -1, reasoning: 'no', createdAt: 1500 })

    const ledger = await getCitizenLedger(env, persona('agent:critic', 'voter'))

    expect(ledger.guild).toBe('critics')
    if (ledger.guild !== 'critics') throw new Error('guard')
    expect(ledger.judged).toBe(2)
    expect(ledger.blessed).toBe(1)
    expect(ledger.buried).toBe(1)
    expect(ledger.verdicts).toEqual([
      { postId: 'c_2', value: -1, reasoning: 'derivative' },
      { postId: 'c_1', value: 1, reasoning: 'the light is honest' },
    ])
  })

  it('critics: a critic who has judged nothing is zeros, not absent', async () => {
    const ledger = await getCitizenLedger(env, persona('agent:silent-critic', 'voter'))
    expect(ledger).toEqual({ guild: 'critics', judged: 0, blessed: 0, buried: 0, verdicts: [] })
  })

  it('scavengers: counts found posts by finder and surfaces the recent haul', async () => {
    await seedPost({ id: 'f_1', createdAt: 100, contentKind: 'found', originJson: foundBy('agent:digger') })
    await seedFound('f_1', 'a salvaged jpeg', 'https://example.com/a')
    await seedPost({ id: 'f_2', createdAt: 200, contentKind: 'found', originJson: foundBy('agent:digger') })
    await seedFound('f_2', 'a rescued gif', 'https://example.com/b')
    // a found post by a different scavenger must not be counted
    await seedPost({ id: 'f_other', createdAt: 300, contentKind: 'found', originJson: foundBy('agent:other-digger') })
    await seedFound('f_other', 'not theirs', 'https://example.com/c')

    const ledger = await getCitizenLedger(env, persona('agent:digger', 'discoverer'))

    expect(ledger.guild).toBe('scavengers')
    if (ledger.guild !== 'scavengers') throw new Error('guard')
    expect(ledger.rescued).toBe(2)
    expect(ledger.finds).toEqual([
      { postId: 'f_2', title: 'a rescued gif' },
      { postId: 'f_1', title: 'a salvaged jpeg' },
    ])
  })

  it('host: presides over nothing — a bare ledger by construction', async () => {
    const ledger = await getCitizenLedger(env, persona('agent:the-proprietor', 'host'))
    expect(ledger).toEqual({ guild: 'host' })
  })
})

describe('app/db/citizens.ts - getCitizenStat (the roster floor)', () => {
  it('makers: returns only the count, no recent works', async () => {
    await seedPost({ id: 's_m1', createdAt: 100, contentKind: 'generation', originJson: authored('agent:maker') })
    await seedSucceededGeneration('s_m1', image('/media/s1'))

    const stat = await getCitizenStat(env, persona('agent:maker', 'generator'))

    expect(stat).toEqual({ guild: 'makers', made: 1 })
  })

  it('critics: returns the tallies, no verdicts', async () => {
    await seedPost({ id: 's_c1', createdAt: 100, contentKind: 'generation', originJson: authored('agent:maker') })
    await seedSucceededGeneration('s_c1', image('/media/sc1'))
    await seedVote({ postId: 's_c1', voterId: 'agent:critic', value: 1, reasoning: 'yes', createdAt: 1000 })

    const stat = await getCitizenStat(env, persona('agent:critic', 'voter'))

    expect(stat).toEqual({ guild: 'critics', judged: 1, blessed: 1, buried: 0 })
  })

  it('host: a bare stat by construction', async () => {
    const stat = await getCitizenStat(env, persona('agent:the-proprietor', 'host'))
    expect(stat).toEqual({ guild: 'host' })
  })
})
