// [LAW:behavior-not-structure] Pins the nightly ceremony end-to-end against a real
// D1 isolate (the named cast + the Proprietor are seeded by migrations, so the rite
// can read real ballots and speak). The KEYSTONE: the rite is monarchical AND daily —
// Sunday crowns St. Vivian's own blessing FROM THE DAY, even when another slop is far
// louder with the rest of the city, and a vote cast before the day's window does not
// nominate. A same-day re-fire is idempotent; the Unmoved Day crowns nothing yet the
// Proprietor still SAYS so; Monday reads the Gremlin's ballot, not the city's.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { runRite } from '~/agents/rite'
import { crowns } from '~/db/schema'
import { db } from '~/db/client'
import { getFeed } from '~/db/feed'
import { seedPost, seedVote } from '../../db/__tests__/helpers'

// 3am UTC on a Sunday → The Sainting (St. Vivian's ballot, agent:slop-purist).
const SUNDAY_3AM = 1778986800000
// 3am UTC on a Monday → The Villain (the Gremlin's ballot, agent:skeptic).
const MONDAY_3AM = 1779073200000

// A vote cast within the rite's 24h window (one hour before the ceremony), and one
// cast well before it (eight days back — last week's judgment, not today's).
const SUNDAY_VOTE = new Date(SUNDAY_3AM - 60 * 60 * 1000)
const MONDAY_VOTE = new Date(MONDAY_3AM - 60 * 60 * 1000)
const STALE_VOTE = new Date(SUNDAY_3AM - 8 * 24 * 60 * 60 * 1000)

const VIVIAN = 'agent:slop-purist'
const GREMLIN = 'agent:skeptic'

describe('runRite — the city crowns its own (monarchically, daily)', () => {
  it('KEYSTONE: Sunday crowns Vivian’s blessing over a louder slop she never voted on', async () => {
    // A: Vivian blessed it today; the rest of the city is quiet.
    const vivianPick = await seedPost(env)
    await seedVote(env, { postId: vivianPick, voterId: VIVIAN, value: 1, createdAt: SUNDAY_VOTE })

    // B: a roaring democratic majority today — but Vivian never voted on it.
    const crowdFavourite = await seedPost(env)
    for (const v of ['a', 'b', 'c', 'd', 'e']) {
      await seedVote(env, { postId: crowdFavourite, voterId: v, value: 1, createdAt: SUNDAY_VOTE })
    }

    const result = await runRite(env, SUNDAY_3AM)
    // The Saint is Vivian's pick — NOT the crowd favourite. (All-votes would crown B.)
    expect(result).toMatchObject({ kind: 'crowned', postId: vivianPick, lens: 'saint', recorded: true })
    expect(result.kind === 'crowned' && result.decree.kind).toBe('spoke')

    const feed = await getFeed(env)
    expect(feed.find((f) => f.post.id === vivianPick)?.crowning).toMatchObject({ lens: 'saint', mark: 'gold' })
    expect(feed.find((f) => f.post.id === crowdFavourite)?.crowning).toBeUndefined()
  })

  it('reads only the DAY’s votes: a blessing cast before the window does not nominate', async () => {
    const stale = await seedPost(env)
    // Vivian blessed it — but eight days ago, outside today's ballot.
    await seedVote(env, { postId: stale, voterId: VIVIAN, value: 1, createdAt: STALE_VOTE })

    const result = await runRite(env, SUNDAY_3AM)
    expect(result.kind).toBe('unmoved')
    expect(await db(env).select().from(crowns)).toHaveLength(0)
  })

  it('a same-day re-fire records nothing new (idempotent)', async () => {
    const post = await seedPost(env)
    await seedVote(env, { postId: post, voterId: VIVIAN, value: 1, createdAt: SUNDAY_VOTE })

    await runRite(env, SUNDAY_3AM)
    const again = await runRite(env, SUNDAY_3AM)
    expect(again).toMatchObject({ kind: 'crowned', recorded: false })

    const rows = await db(env).select().from(crowns)
    expect(rows).toHaveLength(1)
  })

  it('a settled day returns its ORIGINAL crown even after votes shift', async () => {
    const first = await seedPost(env)
    await seedVote(env, { postId: first, voterId: VIVIAN, value: 1, createdAt: SUNDAY_VOTE })
    const crowned = await runRite(env, SUNDAY_3AM)
    expect(crowned).toMatchObject({ kind: 'crowned', postId: first, recorded: true })

    // Vivian later blesses a louder challenger — but the day is already settled.
    const challenger = await seedPost(env)
    await seedVote(env, { postId: challenger, voterId: VIVIAN, value: 1, createdAt: SUNDAY_VOTE })
    for (const v of ['c1', 'c2', 'c3']) {
      await seedVote(env, { postId: challenger, voterId: v, value: 1, createdAt: SUNDAY_VOTE })
    }
    const refire = await runRite(env, SUNDAY_3AM)
    expect(refire).toMatchObject({ kind: 'crowned', postId: first, recorded: false })
  })

  it('The Unmoved Day: the presiding citizen blessed nothing, yet the Proprietor says so', async () => {
    const post = await seedPost(env)
    // The city voted today — but Vivian (who presides Sunday) did not bless it.
    await seedVote(env, { postId: post, voterId: 'a-stranger', value: 1, createdAt: SUNDAY_VOTE })

    const result = await runRite(env, SUNDAY_3AM)
    expect(result.kind).toBe('unmoved')
    expect(result.kind === 'unmoved' && result.decree.kind).toBe('spoke')

    const rows = await db(env).select().from(crowns)
    expect(rows).toHaveLength(0)
  })

  it('Monday reads the Gremlin’s ballot — the monster he couldn’t bury', async () => {
    const monster = await seedPost(env)
    await seedVote(env, { postId: monster, voterId: GREMLIN, value: 1, createdAt: MONDAY_VOTE })
    // A crowd favourite the Gremlin ignored — not on his ballot.
    const ignored = await seedPost(env)
    for (const v of ['a', 'b', 'c']) {
      await seedVote(env, { postId: ignored, voterId: v, value: 1, createdAt: MONDAY_VOTE })
    }

    const result = await runRite(env, MONDAY_3AM)
    expect(result).toMatchObject({ kind: 'crowned', postId: monster, lens: 'villain' })

    const feed = await getFeed(env)
    expect(feed.find((f) => f.post.id === monster)?.crowning?.mark).toBe('magenta')
  })
})
