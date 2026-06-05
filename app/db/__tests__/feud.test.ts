// [LAW:behavior-not-structure] The feud standing DERIVATION contract (voice-w2v.2): the relationship
// between two citizens is read from their shared vote history — opposing/aligned counts, last clash, and
// the classified stance — with NO stored feud status. Runs against real D1 (the self-join is real SQL),
// so the standing is proven derivable from the acts the way score=SUM(votes) is. Blind to the query
// shape; pinned on the counts and the stance the records produce.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { feudStandingBetween } from '~/db/feud'
import { db } from '~/db/client'
import { seedPost, seedVote } from './helpers'

describe('feudStandingBetween', () => {
  it('is NEUTRAL for two citizens who never judged the same slop', async () => {
    const a = await seedPost(env, { id: 'feud-neutral-a' })
    const b = await seedPost(env, { id: 'feud-neutral-b' })
    await seedVote(env, { postId: a, voterId: 'agent:x', value: 1 })
    await seedVote(env, { postId: b, voterId: 'agent:y', value: 1 })

    const standing = await feudStandingBetween(db(env), 'agent:x', 'agent:y')
    expect(standing).toEqual({ opposing: 0, aligned: 0, lastClashAt: null, stance: 'neutral' })
  })

  it('is FEUDING when clashes outnumber agreements, carrying the latest clash time', async () => {
    const p1 = await seedPost(env, { id: 'feud-f-1' })
    const p2 = await seedPost(env, { id: 'feud-f-2' })
    const p3 = await seedPost(env, { id: 'feud-f-3' })
    // two opposing slops, one agreement → opposing(2) > aligned(1) → feuding
    await seedVote(env, { postId: p1, voterId: 'agent:gremlin', value: -1, createdAt: new Date(1000) })
    await seedVote(env, { postId: p1, voterId: 'agent:vivian', value: 1, createdAt: new Date(1500) })
    await seedVote(env, { postId: p2, voterId: 'agent:gremlin', value: -1, createdAt: new Date(3000) })
    await seedVote(env, { postId: p2, voterId: 'agent:vivian', value: 1, createdAt: new Date(2000) })
    await seedVote(env, { postId: p3, voterId: 'agent:gremlin', value: 1, createdAt: new Date(500) })
    await seedVote(env, { postId: p3, voterId: 'agent:vivian', value: 1, createdAt: new Date(500) })

    const standing = await feudStandingBetween(db(env), 'agent:gremlin', 'agent:vivian')
    expect(standing.opposing).toBe(2)
    expect(standing.aligned).toBe(1)
    expect(standing.stance).toBe('feuding')
    // the latest opposing pair is p2 (the later of its two votes is 3000); p1's later vote (1500) is older
    expect(standing.lastClashAt).toEqual(new Date(3000))
  })

  it('is ALLIED when agreements outnumber clashes', async () => {
    const p1 = await seedPost(env, { id: 'feud-al-1' })
    const p2 = await seedPost(env, { id: 'feud-al-2' })
    await seedVote(env, { postId: p1, voterId: 'agent:a', value: 1 })
    await seedVote(env, { postId: p1, voterId: 'agent:b', value: 1 })
    await seedVote(env, { postId: p2, voterId: 'agent:a', value: -1 })
    await seedVote(env, { postId: p2, voterId: 'agent:b', value: -1 })

    const standing = await feudStandingBetween(db(env), 'agent:a', 'agent:b')
    expect(standing).toMatchObject({ opposing: 0, aligned: 2, stance: 'allied' })
  })

  it('is symmetric — standing(x,y) counts the same pairs as standing(y,x)', async () => {
    const p = await seedPost(env, { id: 'feud-sym' })
    await seedVote(env, { postId: p, voterId: 'agent:a', value: 1, createdAt: new Date(10) })
    await seedVote(env, { postId: p, voterId: 'agent:b', value: -1, createdAt: new Date(20) })

    const xy = await feudStandingBetween(db(env), 'agent:a', 'agent:b')
    const yx = await feudStandingBetween(db(env), 'agent:b', 'agent:a')
    expect(yx).toEqual(xy)
    expect(xy.stance).toBe('feuding')
  })

  it('a citizen against itself counts every shared vote as ALIGNED (never a self-feud)', async () => {
    // Degenerate but total: every post the citizen voted on is "shared" with itself, signs always equal.
    const p = await seedPost(env, { id: 'feud-self' })
    await seedVote(env, { postId: p, voterId: 'agent:solo', value: -1 })
    const standing = await feudStandingBetween(db(env), 'agent:solo', 'agent:solo')
    expect(standing).toMatchObject({ opposing: 0, aligned: 1, stance: 'allied' })
  })

  it('ignores a post only ONE of the two judged (no phantom shared history)', async () => {
    const shared = await seedPost(env, { id: 'feud-shared' })
    const solo = await seedPost(env, { id: 'feud-solo' })
    await seedVote(env, { postId: shared, voterId: 'agent:a', value: 1 })
    await seedVote(env, { postId: shared, voterId: 'agent:b', value: 1 })
    await seedVote(env, { postId: solo, voterId: 'agent:a', value: -1 }) // b never voted here

    const standing = await feudStandingBetween(db(env), 'agent:a', 'agent:b')
    expect(standing).toMatchObject({ opposing: 0, aligned: 1, stance: 'allied' })
  })
})
