// [LAW:behavior-not-structure] Pins getCitizenLedger's contract — which deed it
// counts for which guild, and the recent voice/work it surfaces — against a real
// D1 isolate. The three attribution shapes (a maker AUTHORS in origin_json, a
// critic JUDGES in votes, a scavenger FINDS in origin_json) only resolve into one
// ledger if real rows round-trip through it, so the test seeds rows the way the
// live writers do (mirroring pulse.test.ts).

import { describe, expect, it } from 'vitest'
import { NEUTRAL_TRAITS } from '~/lib/traits'
import { env } from 'cloudflare:test'
import {
  feudsAround,
  feudsFor,
  getCitizenLedger,
  getCitizenStat,
  ritePresidedBy,
  signatureStat,
} from '~/db/citizens'
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
    traits: NEUTRAL_TRAITS,
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

async function seedSucceededGeneration(
  postId: string,
  image: Media,
  title = 'a piece',
  styleFamily = 'photoreal',
) {
  await env.DB.prepare(
    `INSERT INTO generations
       (post_id, provider_id, provider_version, params_json, title, style_family,
        subject_template, slots_json, aspect_ratio, status, completed_at, output_json)
     VALUES (?, 'fal-flux', '1', '{}', ?, ?, 'T00', '{"freeText":""}', '1:1',
        'succeeded', ?, ?)`,
  )
    .bind(postId, title, styleFamily, 1000, JSON.stringify(image))
    .run()
}

// A fork child: a generation post whose lineage points back at `parentId`. Authored
// by a forker (not the parent's maker) so it counts toward the parent's most-bred
// lineage without joining the maker's own body.
async function seedForkChild(childId: string, parentId: string, createdAt: number) {
  await seedPost({ id: childId, createdAt, contentKind: 'generation', originJson: authored('agent:forker') })
  await env.DB.prepare(
    `INSERT INTO generations
       (post_id, provider_id, provider_version, params_json, title, style_family,
        subject_template, slots_json, aspect_ratio, status, started_at)
     VALUES (?, 'fal-flux', '1', '{}', 'a fork', 'photoreal', 'T00', '{"freeText":""}', '1:1',
        'running', ?)`,
  )
    .bind(childId, createdAt)
    .run()
  // The lineage lives in the edge DAG now (parent_post_id is gone): one edge = a single
  // (asexual) child, which is what makerHighlights counts as a descendant.
  await env.DB.prepare(
    `INSERT INTO lineage_edges (child_genome_id, parent_genome_id) VALUES (?, ?)`,
  )
    .bind(childId, parentId)
    .run()
}

async function seedFailedGeneration(postId: string, reason = 'provider timeout') {
  await env.DB.prepare(
    `INSERT INTO generations
       (post_id, provider_id, provider_version, params_json, title, style_family,
        subject_template, slots_json, aspect_ratio, status, failed_at, failed_reason)
     VALUES (?, 'fal-flux', '1', '{}', 'a miss', 'photoreal', 'T00', '{"freeText":""}', '1:1',
        'failed', ?, ?)`,
  )
    .bind(postId, 2000, reason)
    .run()
}

async function seedRunningGeneration(postId: string, title = 'a piece') {
  await env.DB.prepare(
    `INSERT INTO generations
       (post_id, provider_id, provider_version, params_json, title, style_family,
        subject_template, slots_json, aspect_ratio, status, started_at)
     VALUES (?, 'fal-flux', '1', '{}', ?, 'photoreal', 'T00', '{"freeText":""}', '1:1',
        'running', ?)`,
  )
    .bind(postId, title, 900)
    .run()
}

// A Well-born slop: a succeeded generation that carries the human's verbatim wish
// (generations.wish, foundation.3). The maker authored it; the wish is what the
// human asked for, beside the slop the maker made instead.
async function seedWishedGeneration(
  postId: string,
  image: Media,
  wish: string,
  title = 'a piece',
) {
  await env.DB.prepare(
    `INSERT INTO generations
       (post_id, provider_id, provider_version, params_json, title, style_family,
        subject_template, slots_json, aspect_ratio, wish, status, completed_at, output_json)
     VALUES (?, 'fal-flux', '1', '{}', ?, 'photoreal', 'T00', '{"freeText":""}', '1:1',
        ?, 'succeeded', ?, ?)`,
  )
    .bind(postId, title, wish, 1000, JSON.stringify(image))
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
  it('makers: counts authored generations and surfaces recent placard lines newest-first', async () => {
    await seedPost({ id: 'm_1', createdAt: 100, contentKind: 'generation', originJson: authored('agent:maker') })
    await seedSucceededGeneration('m_1', image('/media/aaa'), 'I gave it a hallway')
    await seedPost({ id: 'm_2', createdAt: 200, contentKind: 'generation', originJson: authored('agent:maker') })
    await seedRunningGeneration('m_2', 'four steps, never five')
    // a different maker's post must not be counted
    await seedPost({ id: 'm_other', createdAt: 300, contentKind: 'generation', originJson: authored('agent:someone-else') })
    await seedSucceededGeneration('m_other', image('/media/zzz'), 'not mine')

    const ledger = await getCitizenLedger(env, persona('agent:maker', 'generator'))

    expect(ledger.guild).toBe('makers')
    if (ledger.guild !== 'makers') throw new Error('guard')
    expect(ledger.made).toBe(2)
    // VOICE is the placard line only (no image) — newest first
    expect(ledger.works).toEqual([
      { postId: 'm_2', title: 'four steps, never five' },
      { postId: 'm_1', title: 'I gave it a hallway' },
    ])
  })

  it('makers: counts legacy {actor}-shaped attribution the feed still reads', async () => {
    // 0016 leaves cleanly-mappable agent generations in the pre-attribution
    // `{ actor }` shape; the feed resolves author ?? actor, so the ledger must too,
    // or it undercounts older posts the feed attributes to this maker.
    const legacyActor = JSON.stringify({ actor: { kind: 'agent', agentId: 'agent:maker' } })
    await seedPost({ id: 'm_legacy', createdAt: 50, contentKind: 'generation', originJson: legacyActor })
    await seedSucceededGeneration('m_legacy', image('/media/legacy'), 'an old placard')

    const ledger = await getCitizenLedger(env, persona('agent:maker', 'generator'))

    expect(ledger.guild).toBe('makers')
    if (ledger.guild !== 'makers') throw new Error('guard')
    expect(ledger.made).toBe(1)
    expect(ledger.works).toEqual([{ postId: 'm_legacy', title: 'an old placard' }])
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
    // too (as an untitled line) rather than innerJoin it away into a mismatch.
    await seedPost({ id: 'm_orphan', createdAt: 100, contentKind: 'generation', originJson: authored('agent:maker') })

    const ledger = await getCitizenLedger(env, persona('agent:maker', 'generator'))

    expect(ledger.guild).toBe('makers')
    if (ledger.guild !== 'makers') throw new Error('guard')
    expect(ledger.made).toBe(1)
    expect(ledger.works).toEqual([{ postId: 'm_orphan', title: null }])
  })

  it('makers: an empty/whitespace placard collapses to a null voice line (one absence)', async () => {
    // A legacy pre-placard row stores '' (and a stray-whitespace title is as blank);
    // the maker said nothing there, so the voice line is the SAME null absence an
    // orphan carries — never a mechanically-derived stand-in he never spoke.
    await seedPost({ id: 'm_blank', createdAt: 100, contentKind: 'generation', originJson: authored('agent:maker') })
    await seedSucceededGeneration('m_blank', image('/media/blank'), '   ')

    const ledger = await getCitizenLedger(env, persona('agent:maker', 'generator'))

    if (ledger.guild !== 'makers') throw new Error('guard')
    expect(ledger.works).toEqual([{ postId: 'm_blank', title: null }])
  })

  it('scavengers: an orphan found post (no sibling row) is counted AND listed untitled', async () => {
    await seedPost({ id: 'f_orphan', createdAt: 100, contentKind: 'found', originJson: foundBy('agent:digger') })

    const ledger = await getCitizenLedger(env, persona('agent:digger', 'discoverer'))

    expect(ledger.guild).toBe('scavengers')
    if (ledger.guild !== 'scavengers') throw new Error('guard')
    expect(ledger.rescued).toBe(1)
    expect(ledger.finds).toEqual([{ postId: 'f_orphan', title: null }])
  })

  it('scavengers: a whitespace-only find title collapses to a null haul line (one absence)', async () => {
    // The find title takes the same boundary collapse as the maker's placard and
    // the critic's reasoning, so a blank title is the SAME null absence — never an
    // empty link label in the haul.
    await seedPost({ id: 'f_blank', createdAt: 100, contentKind: 'found', originJson: foundBy('agent:digger') })
    await seedFound('f_blank', '   ', 'https://example.com/blank')

    const ledger = await getCitizenLedger(env, persona('agent:digger', 'discoverer'))

    if (ledger.guild !== 'scavengers') throw new Error('guard')
    expect(ledger.finds).toEqual([{ postId: 'f_blank', title: null }])
  })

  it('makers: a maker with nothing made is a real empty ledger, not an error', async () => {
    const ledger = await getCitizenLedger(env, persona('agent:idle-maker', 'generator'))
    expect(ledger).toEqual({
      guild: 'makers',
      made: 0,
      works: [],
      highlights: [],
      styles: [],
      answeredWishes: [],
    })
  })

  it('makers: answered wishes surface the verbatim wish beside its slop, newest-first', async () => {
    // The Act-III reveal — only the Well-born slops (those carrying a wish) appear,
    // each as the human's words and the slop the maker made of them.
    await seedPost({ id: 'w_1', createdAt: 100, contentKind: 'generation', originJson: authored('agent:spirit') })
    await seedWishedGeneration('w_1', image('/media/w1'), 'a quiet house by the sea', 'A Storm-Drowned Tower')
    await seedPost({ id: 'w_2', createdAt: 200, contentKind: 'generation', originJson: authored('agent:spirit') })
    await seedWishedGeneration('w_2', image('/media/w2'), 'my dog, smiling', 'The Hound at the Gate')
    // a plain (un-wished) generation by the same maker must NOT appear here
    await seedPost({ id: 'w_plain', createdAt: 300, contentKind: 'generation', originJson: authored('agent:spirit') })
    await seedSucceededGeneration('w_plain', image('/media/plain'), 'an unbidden piece')

    const ledger = await getCitizenLedger(env, persona('agent:spirit', 'generator'))

    if (ledger.guild !== 'makers') throw new Error('guard')
    expect(ledger.answeredWishes).toEqual([
      { postId: 'w_2', wish: 'my dog, smiling', title: 'The Hound at the Gate', image: '/media/w2' },
      { postId: 'w_1', wish: 'a quiet house by the sea', title: 'A Storm-Drowned Tower', image: '/media/w1' },
    ])
  })

  it('makers: a blank wish is dropped — the panel never renders a hollow quotation', async () => {
    // Real-data-only (the-reveal-contract Surface 2, lock 2): a '' or whitespace wish
    // that slipped past the Well's non-empty guard carries no gap to show, so it drops
    // at the boundary rather than rendering an empty quotation.
    await seedPost({ id: 'w_blank', createdAt: 100, contentKind: 'generation', originJson: authored('agent:spirit') })
    await seedWishedGeneration('w_blank', image('/media/wb'), '   ', 'a piece')

    const ledger = await getCitizenLedger(env, persona('agent:spirit', 'generator'))

    if (ledger.guild !== 'makers') throw new Error('guard')
    expect(ledger.answeredWishes).toEqual([])
  })

  it('makers: curates work by its four axes — best/most-bred/latest/a failure', async () => {
    // best: the most-blessed piece (highest summed score)
    await seedPost({ id: 'hi_best', createdAt: 100, contentKind: 'generation', originJson: authored('agent:hi') })
    await seedSucceededGeneration('hi_best', image('/media/best'), 'the blessed one')
    await seedVote({ postId: 'hi_best', voterId: 'agent:v1', value: 1, reasoning: null, createdAt: 10 })
    await seedVote({ postId: 'hi_best', voterId: 'agent:v2', value: 1, reasoning: null, createdAt: 20 })
    // most-bred: the most-forked piece (two children point back at it)
    await seedPost({ id: 'hi_bred', createdAt: 200, contentKind: 'generation', originJson: authored('agent:hi') })
    await seedSucceededGeneration('hi_bred', image('/media/bred'), 'the fertile one')
    await seedForkChild('hi_child1', 'hi_bred', 210)
    await seedForkChild('hi_child2', 'hi_bred', 220)
    // a failure: a generation that never landed
    await seedPost({ id: 'hi_fail', createdAt: 250, contentKind: 'generation', originJson: authored('agent:hi') })
    await seedFailedGeneration('hi_fail')
    // latest: the newest piece, no votes, no forks
    await seedPost({ id: 'hi_new', createdAt: 300, contentKind: 'generation', originJson: authored('agent:hi') })
    await seedSucceededGeneration('hi_new', image('/media/new'), 'the newest one')

    const ledger = await getCitizenLedger(env, persona('agent:hi', 'generator'))
    if (ledger.guild !== 'makers') throw new Error('guard')

    // canonical order: best · most-bred · latest · a failure; each a distinct piece
    expect(ledger.highlights).toEqual([
      { postId: 'hi_best', title: 'the blessed one', image: '/media/best', labels: [{ kind: 'best', score: 2 }] },
      { postId: 'hi_bred', title: 'the fertile one', image: '/media/bred', labels: [{ kind: 'most-bred', children: 2 }] },
      { postId: 'hi_new', title: 'the newest one', image: '/media/new', labels: [{ kind: 'latest' }] },
      // a failure keeps its placard but never landed an image — the honest miss
      { postId: 'hi_fail', title: 'a miss', image: null, labels: [{ kind: 'failure' }] },
    ])
  })

  it('makers: one piece can earn several axes — merged onto a single thumbnail', async () => {
    // a maker with one blessed post: it is both his best AND his latest, one frame
    await seedPost({ id: 'solo', createdAt: 100, contentKind: 'generation', originJson: authored('agent:solo') })
    await seedSucceededGeneration('solo', image('/media/solo'), 'the only one')
    await seedVote({ postId: 'solo', voterId: 'agent:v', value: 1, reasoning: null, createdAt: 10 })

    const ledger = await getCitizenLedger(env, persona('agent:solo', 'generator'))
    if (ledger.guild !== 'makers') throw new Error('guard')

    expect(ledger.highlights).toEqual([
      {
        postId: 'solo',
        title: 'the only one',
        image: '/media/solo',
        labels: [{ kind: 'best', score: 1 }, { kind: 'latest' }],
      },
    ])
  })

  it('makers: an all-zero, never-forked body still has a latest, but no best/most-bred', async () => {
    // best needs an up-score; most-bred needs a fork. Absent signals filter out by
    // data — the newest piece is the only axis a fresh maker has earned.
    await seedPost({ id: 'fresh', createdAt: 100, contentKind: 'generation', originJson: authored('agent:fresh') })
    await seedSucceededGeneration('fresh', image('/media/fresh'), 'untested')

    const ledger = await getCitizenLedger(env, persona('agent:fresh', 'generator'))
    if (ledger.guild !== 'makers') throw new Error('guard')

    expect(ledger.highlights).toEqual([
      { postId: 'fresh', title: 'untested', image: '/media/fresh', labels: [{ kind: 'latest' }] },
    ])
  })

  it('makers: surfaces the territory it works in most, by frequency', async () => {
    const seedStyle = async (id: string, createdAt: number, styleFamily: string) => {
      await seedPost({ id, createdAt, contentKind: 'generation', originJson: authored('agent:painter') })
      await seedSucceededGeneration(id, image(`/media/${id}`), 'a piece', styleFamily)
    }
    await seedStyle('st_a', 100, 'liminal')
    await seedStyle('st_b', 110, 'liminal')
    await seedStyle('st_c', 120, 'liminal')
    await seedStyle('st_d', 130, 'anime')
    await seedStyle('st_e', 140, 'anime')
    await seedStyle('st_f', 150, 'photoreal')

    const ledger = await getCitizenLedger(env, persona('agent:painter', 'generator'))
    if (ledger.guild !== 'makers') throw new Error('guard')

    // most-frequent first, capped at three
    expect(ledger.styles).toEqual(['liminal', 'anime', 'photoreal'])
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

  it('critics: empty/whitespace reasoning is normalized to null (one absence)', async () => {
    // The vote schema admits an empty string; the verdict must not carry "" (which
    // would paint an empty, unlabeled line) — it collapses to null like a human vote.
    await seedPost({ id: 'c_e', createdAt: 100, contentKind: 'generation', originJson: authored('agent:maker') })
    await seedSucceededGeneration('c_e', image('/media/ce'))
    await seedVote({ postId: 'c_e', voterId: 'agent:critic', value: 1, reasoning: '   ', createdAt: 1000 })

    const ledger = await getCitizenLedger(env, persona('agent:critic', 'voter'))

    if (ledger.guild !== 'critics') throw new Error('guard')
    expect(ledger.verdicts).toEqual([{ postId: 'c_e', value: 1, reasoning: null }])
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

describe('app/db/citizens.ts - signatureStat (the one line a citizen is known by)', () => {
  it('makers are known by what they made', () => {
    expect(signatureStat({ guild: 'makers', made: 412 })).toBe('412 made')
  })

  it('a critic who mostly blesses is known by the blessing', () => {
    expect(signatureStat({ guild: 'critics', judged: 1300, blessed: 1204, buried: 96 })).toBe(
      '1204 blessed',
    )
  })

  it('a critic who mostly buries is known by the burial', () => {
    expect(signatureStat({ guild: 'critics', judged: 2900, blessed: 9, buried: 2891 })).toBe(
      '2891 buried',
    )
  })

  it('a tie resolves to blessed — reverent about garbage before savage about the mid', () => {
    expect(signatureStat({ guild: 'critics', judged: 4, blessed: 2, buried: 2 })).toBe('2 blessed')
  })

  it('scavengers are known by what they rescued', () => {
    expect(signatureStat({ guild: 'scavengers', rescued: 156 })).toBe('156 rescued')
  })

  it('the host keeps the keys', () => {
    expect(signatureStat({ guild: 'host' })).toBe('keeps the keys')
  })
})

describe('app/db/citizens.ts - feudsFor (the standing rivalries, resolved)', () => {
  const roster = new Map([
    ['guttermonk', 'GutterMonk'],
    ['vesper-sloan', 'Vesper Sloan'],
    ['st-vivian', 'St. Vivian'],
    ['the-gremlin', 'The Gremlin'],
    ['the-formalist', 'The Formalist'],
  ])

  it('resolves a rivalry to the rival handle + display name from the live roster', () => {
    // the roster flag is the link only — no reason prose (that lives on Feud, the
    // shrine shape, so the roster loader ships no prose it does not render)
    expect(feudsFor('guttermonk', roster)).toEqual([
      { rivalHandle: 'the-gremlin', rivalName: 'The Gremlin' },
    ])
  })

  it('the formalist feuds vesper, not the gremlin — the relation is data, not one target', () => {
    expect(
      feudsFor('the-formalist', roster).map((f) => ({
        rivalHandle: f.rivalHandle,
        rivalName: f.rivalName,
      })),
    ).toEqual([{ rivalHandle: 'vesper-sloan', rivalName: 'Vesper Sloan' }])
  })

  it('the gremlin is the fixed antagonist: everyone flags him, he feuds no one', () => {
    expect(feudsFor('the-gremlin', roster)).toEqual([])
  })

  it('a citizen with no feud (the host, a scavenger) carries none', () => {
    expect(feudsFor('the-ragpicker', roster)).toEqual([])
    expect(feudsFor('the-proprietor', roster)).toEqual([])
  })

  it('an un-minted citizen (null handle) is no one’s rival and has no feud', () => {
    expect(feudsFor(null, roster)).toEqual([])
  })

  it('an edge whose rival is absent from the live roster collapses out — no dead link', () => {
    const withoutGremlin = new Map([['guttermonk', 'GutterMonk']])
    expect(feudsFor('guttermonk', withoutGremlin)).toEqual([])
  })
})

describe('app/db/citizens.ts - feudsAround (the shrine lens: every edge that touches a citizen)', () => {
  const roster = new Map([
    ['guttermonk', 'GutterMonk'],
    ['vesper-sloan', 'Vesper Sloan'],
    ['st-vivian', 'St. Vivian'],
    ['the-gremlin', 'The Gremlin'],
    ['the-formalist', 'The Formalist'],
  ])

  it('a citizen who declares a grudge carries it outgoing, with the canon reason', () => {
    const around = feudsAround('guttermonk', roster)
    expect(around).toHaveLength(1)
    expect(around[0]).toMatchObject({
      rivalHandle: 'the-gremlin',
      rivalName: 'The Gremlin',
      stance: 'declares',
    })
    expect(around[0].reason).toMatch(/silence/)
  })

  it('the gremlin declares none yet his shrine fills with the city — all targeted-by', () => {
    const around = feudsAround('the-gremlin', roster)
    expect(around.every((f) => f.stance === 'targeted-by')).toBe(true)
    expect(around.map((f) => f.rivalHandle).sort()).toEqual([
      'guttermonk',
      'st-vivian',
      'vesper-sloan',
    ])
  })

  it('vesper both declares (vs the gremlin) and is targeted-by (the formalist)', () => {
    const stances = feudsAround('vesper-sloan', roster).map((f) => ({
      handle: f.rivalHandle,
      stance: f.stance,
    }))
    expect(stances).toContainEqual({ handle: 'the-gremlin', stance: 'declares' })
    expect(stances).toContainEqual({ handle: 'the-formalist', stance: 'targeted-by' })
  })

  it('an edge whose other end is absent from the roster collapses out — no dead link', () => {
    expect(feudsAround('guttermonk', new Map([['guttermonk', 'GutterMonk']]))).toEqual([])
  })

  it('an un-minted citizen (null handle) is touched by no edge', () => {
    expect(feudsAround(null, roster)).toEqual([])
  })
})

describe('app/db/citizens.ts - ritePresidedBy (the rite a citizen presides over)', () => {
  it('a citizen the liturgical week seats presides over their rite', () => {
    expect(ritePresidedBy('guttermonk')).toMatchObject({ day: 'Saturday', rite: 'The Confession' })
    expect(ritePresidedBy('the-proprietor')).toMatchObject({ day: 'Friday', rite: 'The Miracle' })
  })

  it('a citizen the week does not seat presides over nothing — a real absence', () => {
    expect(ritePresidedBy('idris')).toBeNull()
    expect(ritePresidedBy('the-formalist')).toBeNull()
  })

  it('an un-minted citizen (null handle) presides over nothing', () => {
    expect(ritePresidedBy(null)).toBeNull()
  })
})
