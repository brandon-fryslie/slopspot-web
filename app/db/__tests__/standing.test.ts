// [LAW:behavior-not-structure] Pins getStandings's contract — which reception currency
// each guild's arc is read from, and that the windows split votes by when they were CAST
// (not when the post was made), so an old post freshly loved reads as recent reception.
// Standing only resolves correctly if real votes round-trip through the two-window split,
// so the test seeds votes the way setVote writes them (mirroring citizens.test).

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { getStandings } from '~/db/standing'
import { seedPost, seedVote } from './helpers'
import { AgentId, PostId, type Origin } from '~/lib/domain'
import { NEUTRAL_TRAITS } from '~/lib/traits'
import type { Persona, PersonaRole } from '~/agents/persona'

const NOW = new Date('2026-06-09T12:00:00Z').getTime()
const DAY = 24 * 60 * 60 * 1000
// A time inside the recent window (last 14d) and one inside the prior window (14–28d).
const RECENT = new Date(NOW - 1 * DAY)
const PRIOR = new Date(NOW - 20 * DAY)
const STALE = new Date(NOW - 40 * DAY) // older than both windows — must not count.

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

const authored = (agentId: string): Origin => ({
  kind: 'authored',
  author: { kind: 'agent', agentId: AgentId(agentId) },
})
const foundBy = (agentId: string): Origin => ({
  kind: 'found',
  finder: { kind: 'agent', agentId: AgentId(agentId) },
})

// Seed `n` upvotes on a post at a fixed time, each from a distinct voter (the votes PK is
// (post_id, voter_id), so distinct voters are required to accumulate score).
async function upvotes(postId: PostId, n: number, at: Date, tag: string): Promise<void> {
  for (let i = 0; i < n; i++) {
    await seedVote(env, { postId, voterId: `voter:${tag}:${i}`, value: 1, createdAt: at })
  }
}

// Cast `n` votes BY a critic at a fixed time, each on a distinct throwaway post (so the
// per-post PK does not collide and each vote is a separate act by the same critic).
async function castBy(critic: string, n: number, at: Date): Promise<void> {
  for (let i = 0; i < n; i++) {
    const target = await seedPost(env, {
      origin: authored('agent:target-author'),
      content: { kind: 'generation' },
    })
    await seedVote(env, { postId: target, voterId: critic, value: 1, createdAt: at })
  }
}

describe('getStandings', () => {
  it('reads a maker whose work is freshly landing as ascendant', async () => {
    const maker = 'agent:maker-rising'
    const post = await seedPost(env, { origin: authored(maker), content: { kind: 'generation' } })
    await upvotes(post, 6, RECENT, 'rising-recent')

    const standings = await getStandings(env, [persona(maker, 'generator')], NOW)
    expect(standings.get(maker)).toBe('ascendant')
  })

  it('reads a maker whose reception has dried up as fading', async () => {
    const maker = 'agent:maker-fading'
    const post = await seedPost(env, { origin: authored(maker), content: { kind: 'generation' } })
    await upvotes(post, 7, PRIOR, 'fading-prior')
    await upvotes(post, 1, RECENT, 'fading-recent')

    const standings = await getStandings(env, [persona(maker, 'generator')], NOW)
    expect(standings.get(maker)).toBe('fading')
  })

  it('reads a maker with no recent reception as steady', async () => {
    const maker = 'agent:maker-quiet'
    const post = await seedPost(env, { origin: authored(maker), content: { kind: 'generation' } })
    // A handful of votes, balanced across the windows — a wobble, not an arc.
    await upvotes(post, 3, PRIOR, 'quiet-prior')
    await upvotes(post, 3, RECENT, 'quiet-recent')

    const standings = await getStandings(env, [persona(maker, 'generator')], NOW)
    expect(standings.get(maker)).toBe('steady')
  })

  it('ignores votes older than both windows', async () => {
    const maker = 'agent:maker-stale'
    const post = await seedPost(env, { origin: authored(maker), content: { kind: 'generation' } })
    await upvotes(post, 20, STALE, 'stale')

    const standings = await getStandings(env, [persona(maker, 'generator')], NOW)
    // The big stale haul is outside the span, so the citizen reads as a blank slate.
    expect(standings.get(maker)).toBe('steady')
  })

  it("windows by when a vote was CAST, not when the post was made", async () => {
    // An OLD post (created long ago) that the city only just discovered and upvoted now
    // reads as RECENT reception — the arc tracks the city's attention, not the post's age.
    const maker = 'agent:maker-resurfaced'
    const post = await seedPost(env, {
      origin: authored(maker),
      content: { kind: 'generation' },
      createdAt: STALE,
    })
    await upvotes(post, 6, RECENT, 'resurfaced')

    const standings = await getStandings(env, [persona(maker, 'generator')], NOW)
    expect(standings.get(maker)).toBe('ascendant')
  })

  it('reads a critic on a fresh judging streak as ascendant', async () => {
    const critic = 'agent:critic-busy'
    await castBy(critic, 6, RECENT)

    const standings = await getStandings(env, [persona(critic, 'voter')], NOW)
    expect(standings.get(critic)).toBe('ascendant')
  })

  it('reads a critic who has gone quiet as fading', async () => {
    const critic = 'agent:critic-quiet'
    await castBy(critic, 8, PRIOR)
    await castBy(critic, 1, RECENT)

    const standings = await getStandings(env, [persona(critic, 'voter')], NOW)
    expect(standings.get(critic)).toBe('fading')
  })

  it("reads a scavenger's haul reception from its found posts", async () => {
    const scav = 'agent:scav-rising'
    const post = await seedPost(env, {
      origin: foundBy(scav),
      content: { kind: 'found' },
    })
    await upvotes(post, 6, RECENT, 'scav-recent')

    const standings = await getStandings(env, [persona(scav, 'discoverer')], NOW)
    expect(standings.get(scav)).toBe('ascendant')
  })

  it('gives the host no standing — it presides, it has no arc', async () => {
    const standings = await getStandings(env, [persona('agent:the-host', 'host')], NOW)
    expect(standings.has('agent:the-host')).toBe(false)
  })

  it('returns one entry per non-host citizen, even with zero reception', async () => {
    const cast = [
      persona('agent:m1', 'generator'),
      persona('agent:c1', 'voter'),
      persona('agent:s1', 'discoverer'),
      persona('agent:h1', 'host'),
    ]
    const standings = await getStandings(env, cast, NOW)
    expect(standings.get('agent:m1')).toBe('steady')
    expect(standings.get('agent:c1')).toBe('steady')
    expect(standings.get('agent:s1')).toBe('steady')
    expect(standings.has('agent:h1')).toBe(false)
  })
})
