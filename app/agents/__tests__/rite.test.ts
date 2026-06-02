// [LAW:behavior-not-structure] Pins the nightly ceremony end-to-end against a real
// D1 isolate (the Proprietor is seeded by migration 0019, so the rite can speak):
// on a day with a worthy slop the rite crowns it and the feed wears the derived
// mark; a same-day re-fire is idempotent; the Unmoved Day crowns nothing and yet the
// Proprietor still SAYS so, in voice; and the pole reads the vote extreme (Monday
// buries the monster the city downvoted hardest).

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { runRite } from '~/agents/rite'
import { crowns } from '~/db/schema'
import { db } from '~/db/client'
import { getFeed } from '~/db/feed'
import { seedPost, seedVote } from '../../db/__tests__/helpers'

// 3am UTC on a Sunday → The Sainting (blessed pole, gold mark).
const SUNDAY_3AM = 1778986800000
// 3am UTC on a Monday → The Villain (buried pole, magenta mark).
const MONDAY_3AM = 1779073200000

describe('runRite — crowns the city’s own', () => {
  it('crowns a worthy slop and the feed wears the derived mark', async () => {
    const post = await seedPost(env)
    await seedVote(env, { postId: post, voterId: 'v1', value: 1 })
    await seedVote(env, { postId: post, voterId: 'v2', value: 1 })
    await seedVote(env, { postId: post, voterId: 'v3', value: 1 })

    const result = await runRite(env, SUNDAY_3AM)
    expect(result).toMatchObject({ kind: 'crowned', postId: post, lens: 'saint', recorded: true })
    expect(result.kind === 'crowned' && result.decree.kind).toBe('spoke')

    const feed = await getFeed(env)
    expect(feed.find((f) => f.post.id === post)?.crowning).toMatchObject({
      lens: 'saint',
      mark: 'gold',
    })
  })

  it('a same-day re-fire records nothing new (idempotent)', async () => {
    const post = await seedPost(env)
    await seedVote(env, { postId: post, voterId: 'v1', value: 1 })
    await seedVote(env, { postId: post, voterId: 'v2', value: 1 })
    await seedVote(env, { postId: post, voterId: 'v3', value: 1 })

    await runRite(env, SUNDAY_3AM)
    const again = await runRite(env, SUNDAY_3AM)
    expect(again).toMatchObject({ kind: 'crowned', recorded: false })

    const rows = await db(env).select().from(crowns)
    expect(rows).toHaveLength(1)
  })

  it('a settled day returns its ORIGINAL crown even after votes shift', async () => {
    const first = await seedPost(env)
    await seedVote(env, { postId: first, voterId: 'v1', value: 1 })
    await seedVote(env, { postId: first, voterId: 'v2', value: 1 })
    await seedVote(env, { postId: first, voterId: 'v3', value: 1 })
    const crowned = await runRite(env, SUNDAY_3AM)
    expect(crowned).toMatchObject({ kind: 'crowned', postId: first, recorded: true })

    // A new challenger now outscores the crowned post — but the day is already settled.
    const challenger = await seedPost(env)
    for (const v of ['c1', 'c2', 'c3', 'c4', 'c5']) {
      await seedVote(env, { postId: challenger, voterId: v, value: 1 })
    }
    const refire = await runRite(env, SUNDAY_3AM)
    // The original crown stands — never a re-election to the new extreme.
    expect(refire).toMatchObject({ kind: 'crowned', postId: first, recorded: false })
  })

  it('The Unmoved Day: crowns nothing, yet the Proprietor says so in voice', async () => {
    const post = await seedPost(env)
    // One lonely blessing — below the intensity bar. The mid does not get crowned.
    await seedVote(env, { postId: post, voterId: 'v1', value: 1 })

    const result = await runRite(env, SUNDAY_3AM)
    expect(result.kind).toBe('unmoved')
    expect(result.kind === 'unmoved' && result.decree.kind).toBe('spoke')

    const rows = await db(env).select().from(crowns)
    expect(rows).toHaveLength(0)
  })

  it('reads the vote extreme: Monday buries the most-downvoted monster', async () => {
    const monster = await seedPost(env)
    await seedVote(env, { postId: monster, voterId: 'v1', value: -1 })
    await seedVote(env, { postId: monster, voterId: 'v2', value: -1 })
    await seedVote(env, { postId: monster, voterId: 'v3', value: -1 })

    const result = await runRite(env, MONDAY_3AM)
    expect(result).toMatchObject({ kind: 'crowned', postId: monster, lens: 'villain' })

    const feed = await getFeed(env)
    expect(feed.find((f) => f.post.id === monster)?.crowning?.mark).toBe('magenta')
  })
})
