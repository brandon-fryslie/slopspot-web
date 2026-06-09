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
  museumCrownings,
  crowningForDay,
  crowningsForPosts,
  gatherCandidates,
  feastsToday,
  recordCrowning,
} from '~/db/crowns'
import { getFeedPage } from '~/db/feed'
import { AgentId, PostId } from '~/lib/domain'
import type { DeviantCandidate, RiteBallot } from '~/lib/rite'
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
      kind: 'voted',
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
    expect(candidates[0]).toEqual({ kind: 'voted', postId: a, overallScore: 2, citizenVotes: {} })
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

const DEVIANCE: RiteBallot = { kind: 'deviance' }

function deviants(candidates: readonly { kind: string }[]): DeviantCandidate[] {
  return candidates.filter((c): c is DeviantCandidate => c.kind === 'deviant')
}

describe('gatherCandidates — the Heretic gathers the day’s recipe outliers', () => {
  const photoreal = (over: Partial<{ aspectRatio: '1:1' | '16:9'; providerId: string; freeText: string }> = {}) =>
    ({
      kind: 'generation' as const,
      styleFamily: 'photoreal' as const,
      aspectRatio: over.aspectRatio ?? ('1:1' as const),
      providerId: over.providerId ?? 'fal-flux',
      subject: { subjectTemplate: 'T00' as const, slots: { freeText: over.freeText ?? 'same' } },
    })

  it('weighs in-window succeeded generations by deviance from their own style-family cohort', async () => {
    // Two photoreal twins + one photoreal that diverges in subject, aspect, AND provider.
    await seedPost(env, { createdAt: IN_WINDOW, content: photoreal() })
    await seedPost(env, { createdAt: IN_WINDOW, content: photoreal() })
    const heretic = await seedPost(env, {
      createdAt: IN_WINDOW,
      content: photoreal({ aspectRatio: '16:9', providerId: 'replicate-sdxl', freeText: 'different' }),
    })

    const candidates = await gatherCandidates(env, DEVIANCE, WINDOW)
    expect(candidates).toHaveLength(3)
    expect(deviants(candidates)).toHaveLength(3) // every candidate is recipe-side, not a vote
    const top = [...deviants(candidates)].sort((x, y) => y.deviance - x.deviance)[0]
    expect(top.postId).toBe(heretic) // the outlier is the heretic
    expect(top.deviance).toBeGreaterThan(0)
  })

  it('windows over the GENERATION, not votes: a slop made before the window does not nominate', async () => {
    await seedPost(env, { createdAt: BEFORE_WINDOW, content: photoreal() })
    await seedPost(env, { createdAt: BEFORE_WINDOW, content: photoreal() })
    expect(await gatherCandidates(env, DEVIANCE, WINDOW)).toHaveLength(0)
  })

  it('excludes generations that did not succeed', async () => {
    const failed = {
      kind: 'generation' as const,
      styleFamily: 'photoreal' as const,
      status: { kind: 'failed' as const, reason: 'boom', failedAt: new Date('2026-01-01') },
    }
    await seedPost(env, { createdAt: IN_WINDOW, content: failed })
    await seedPost(env, { createdAt: IN_WINDOW, content: failed })
    expect(await gatherCandidates(env, DEVIANCE, WINDOW)).toHaveLength(0)
  })

  it('a lone slop in its family yields no candidate — no orthodoxy to defy', async () => {
    await seedPost(env, { createdAt: IN_WINDOW, content: { kind: 'generation', styleFamily: 'anime' } })
    await seedPost(env, { createdAt: IN_WINDOW, content: { kind: 'generation', styleFamily: 'cyberpunk-neon' } })
    expect(await gatherCandidates(env, DEVIANCE, WINDOW)).toHaveLength(0)
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

    const feed = (await getFeedPage(env, {})).items
    const crowned = feed.find((f) => f.post.id === crownedId)
    const uncrowned = feed.find((f) => f.post.id === plain)

    expect(crowned?.crowning).toMatchObject({ lens: 'saint', mark: 'gold', riteDay: '2026-05-17' })
    // [LAW:dataflow-not-control-flow] An uncrowned post has NO crowning — absence is
    // the discriminator, not a stored flag.
    expect(uncrowned?.crowning).toBeUndefined()
  })
})

// [LAW:behavior-not-structure] Pin the museum reader's contract: it returns the crowns of
// exactly the lenses asked for, newest-first, with the decree parsed and the presiding
// citizen's name resolved (or the agentId as the fallback label). This is what the Calendar
// of Saints and the Rogues' Gallery read — the hall's order and membership, not internals.
async function seedPresider(agentId: string, handle: string, displayName: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO personas
       (agent_id, handle, display_name, role, persona_prompt, model_id, config_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(agentId, handle, displayName, 'host', 'p', 'm', '{}', 0)
    .run()
}

describe('museumCrownings — the hall reader', () => {
  it('returns only the asked-for lenses, newest-first, with decree + presiding name', async () => {
    await seedPresider('agent:vivian-m', 'vivian', 'St. Vivian')
    const relicPost = await seedPost(env)
    const saintPost = await seedPost(env)
    const villainPost = await seedPost(env)

    // A relic on an earlier day, a saint on a later day, a villain (other hall) latest.
    await recordCrowning(env, {
      postId: relicPost,
      riteDay: '2026-05-10',
      lens: 'relic',
      presiding: AgentId('agent:vivian-m'),
      decree: spoke('Dragged back from the dead.'),
    })
    await recordCrowning(env, {
      postId: saintPost,
      riteDay: '2026-05-12',
      lens: 'saint',
      presiding: AgentId('agent:vivian-m'),
      decree: spoke('Canonised through its flaw.'),
    })
    await recordCrowning(env, {
      postId: villainPost,
      riteDay: '2026-05-14',
      lens: 'villain',
      presiding: AgentId('agent:vivian-m'),
      decree: spoke('Booed with love.'),
    })

    const venerated = await museumCrownings(env, ['saint', 'relic', 'martyr', 'miracle', 'confession'])
    // The villain is excluded (other hall); the saint (later day) precedes the relic.
    expect(venerated.map((c) => c.postId)).toEqual([saintPost, relicPost])
    expect(venerated[0].lens).toBe('saint')
    expect(venerated[0].decree).toEqual(spoke('Canonised through its flaw.'))
    expect(venerated[0].presiding.displayName).toBe('St. Vivian')
    expect(venerated[0].presiding.handle).toBe('vivian')
  })

  it('falls back to the agentId as the label when the presider has no persona', async () => {
    const post = await seedPost(env)
    await recordCrowning(env, {
      postId: post,
      riteDay: '2026-05-20',
      lens: 'heretic',
      presiding: AgentId('agent:ghost-presider'),
      decree: spoke('Defied its own recipe.'),
    })
    const rogues = await museumCrownings(env, ['villain', 'heretic'])
    const entry = rogues.find((c) => c.postId === post)
    expect(entry?.presiding.displayName).toBe('agent:ghost-presider')
    expect(entry?.presiding.handle).toBeNull()
  })

  it('an empty lens set returns no rows by data, not a branch', async () => {
    await seedPost(env).then((p) =>
      recordCrowning(env, {
        postId: p,
        riteDay: '2026-05-22',
        lens: 'saint',
        presiding: AgentId('agent:vivian-m'),
        decree: spoke('x'),
      }),
    )
    expect(await museumCrownings(env, [])).toEqual([])
  })
})

// [LAW:behavior-not-structure] feastsToday returns the VENERATED dead whose canonisation
// day-of-month recurs on the given UTC day — names the presiding citizen, links the post,
// excludes the rogues (a villain gets notoriety, not a feast), and obeys the month-end clamp.
describe('feastsToday — the venerated whose canonisation anniversary falls today', () => {
  // agent:slop-purist (St. Vivian, handle st-vivian) is seeded by migration 0017 — the presiding
  // name resolves from that row, so each case seeds only the posts and the crowns.
  it('returns a saint canonised on today’s DOM, names the citizen, excludes rogues and other days', async () => {
    const saint = await seedPost(env)
    const villain = await seedPost(env)
    const offDay = await seedPost(env)
    await recordCrowning(env, { postId: saint, riteDay: '2025-11-15', lens: 'saint', presiding: VIVIAN, decree: DECREE })
    // Same DOM (15) but a ROGUE lens — notoriety, never a feast.
    await recordCrowning(env, { postId: villain, riteDay: '2025-12-15', lens: 'villain', presiding: VIVIAN, decree: DECREE })
    // A venerated relic, but its DOM (9) is not today's.
    await recordCrowning(env, { postId: offDay, riteDay: '2025-10-09', lens: 'relic', presiding: VIVIAN, decree: DECREE })

    const feasts = await feastsToday(env, Date.UTC(2026, 0, 15, 12))
    expect(feasts).toEqual([
      {
        postId: saint,
        lens: 'saint',
        riteDay: '2025-11-15',
        presiding: { handle: 'st-vivian', displayName: 'St. Vivian' },
      },
    ])
  })

  it('month-end clamp: a saint of the 31st is remembered on Apr 30', async () => {
    const saint = await seedPost(env)
    await recordCrowning(env, { postId: saint, riteDay: '2026-01-31', lens: 'saint', presiding: VIVIAN, decree: DECREE })

    expect(await feastsToday(env, Date.UTC(2026, 3, 30, 12))).toHaveLength(1)
    // But not on Apr 29 (an ordinary day that is not the 31st nor the month's end).
    expect(await feastsToday(env, Date.UTC(2026, 3, 29, 12))).toHaveLength(0)
  })

  it('returns nothing when no venerated crown’s anniversary falls today', async () => {
    const saint = await seedPost(env)
    await recordCrowning(env, { postId: saint, riteDay: '2025-11-09', lens: 'saint', presiding: VIVIAN, decree: DECREE })
    expect(await feastsToday(env, Date.UTC(2026, 0, 15, 12))).toEqual([])
  })

  // [LAW:no-silent-failure] A slop can carry more than one venerated crown (crowns is UNIQUE on
  // rite_day, not post+lens). When two of them share a DOM, BOTH feast today — feastsToday must
  // surface both (the render keys on rite_day, so neither saint is silently dropped).
  it('surfaces every same-DOM venerated crown of a post, not just one', async () => {
    const post = await seedPost(env)
    await recordCrowning(env, { postId: post, riteDay: '2025-01-15', lens: 'saint', presiding: VIVIAN, decree: DECREE })
    await recordCrowning(env, { postId: post, riteDay: '2025-03-15', lens: 'relic', presiding: VIVIAN, decree: DECREE })

    const feasts = await feastsToday(env, Date.UTC(2026, 0, 15, 12))
    expect(feasts.map((f) => `${f.lens}:${f.riteDay}`).sort()).toEqual([
      'relic:2025-03-15',
      'saint:2025-01-15',
    ])
  })
})
