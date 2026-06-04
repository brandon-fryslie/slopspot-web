import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { getCitizenVoteCounts, getNicheGenePool, type Niche } from '~/db/genepool'
import { setVote } from '~/db/votes'
import { PostId } from '~/lib/domain'
import { seedPost } from './helpers'

// [LAW:behavior-not-structure] The per-niche gene-pool read's contract: the genomes a given
// niche has SELECTED, weighted by that niche's net vote, succeeded-generations only. Fitness
// is established the only way it can be — through setVote (the one vote writer) — so the test
// exercises the real votes→snapshot path. Each cast voter-citizen is a niche; humans are one
// separate niche, never folded into a citizen's.

const ST_VIVIAN = 'voter:st-vivian'
const GREMLIN = 'voter:gremlin'
const CITIZENS = [ST_VIVIAN, GREMLIN]

const vote = (postId: PostId, voterId: string, value: 1 | -1) =>
  setVote({ postId, voterId, value, reasoning: 'agent verdict' }, { env })
const humanVote = (postId: PostId, voterId: string, value: 1 | -1) =>
  setVote({ postId, voterId, value }, { env })

const citizenNiche = (voterId: string): Niche => ({ kind: 'citizen', voterId })
const populist: Niche = { kind: 'populist', citizenVoterIds: CITIZENS }

describe('getNicheGenePool — one niche\'s breedable snapshot', () => {
  it('returns only the genomes THIS citizen selected, weighted by that citizen\'s vote', async () => {
    const a = await seedPost(env, { id: 'np-a', content: { kind: 'generation' } })
    const b = await seedPost(env, { id: 'np-b', content: { kind: 'generation' } })
    const c = await seedPost(env, { id: 'np-c', content: { kind: 'generation' } })

    await vote(a, ST_VIVIAN, 1) // St. Vivian blesses a
    await vote(b, ST_VIVIAN, -1) // and buries b
    await vote(c, GREMLIN, 1) // the Gremlin blesses c (a different niche)

    const pool = await getNicheGenePool(env, citizenNiche(ST_VIVIAN), 50)

    // Only a (+1) and b (-1) appear — c is in the Gremlin's niche, invisible here.
    expect(pool).toEqual([
      { ref: PostId('np-a'), fitness: 1 },
      { ref: PostId('np-b'), fitness: -1 },
    ])
  })

  it('keeps niches independent — a line buried in one niche can be blessed in another (death is niche-local)', async () => {
    const x = await seedPost(env, { id: 'np-x', content: { kind: 'generation' } })
    await vote(x, ST_VIVIAN, -1) // buried by St. Vivian
    await vote(x, GREMLIN, 1) // blessed by the Gremlin

    const vivian = await getNicheGenePool(env, citizenNiche(ST_VIVIAN), 50)
    const gremlin = await getNicheGenePool(env, citizenNiche(GREMLIN), 50)

    expect(vivian).toEqual([{ ref: PostId('np-x'), fitness: -1 }]) // dead in Vivian's niche
    expect(gremlin).toEqual([{ ref: PostId('np-x'), fitness: 1 }]) // alive in the Gremlin's
  })

  it('the populist niche sums HUMAN votes and excludes every cast citizen\'s vote', async () => {
    const p = await seedPost(env, { id: 'np-p', content: { kind: 'generation' } })
    await humanVote(p, 'anon-h1', 1)
    await humanVote(p, 'anon-h2', 1)
    await humanVote(p, 'anon-h3', 1)
    await vote(p, ST_VIVIAN, -1) // a cast citizen's downvote must NOT fold into the popular line

    const pool = await getNicheGenePool(env, populist, 50)

    // 3 human upvotes, the citizen's -1 excluded → fitness 3, not 2.
    expect(pool).toEqual([{ ref: PostId('np-p'), fitness: 3 }])
  })

  it('orders by the niche\'s net vote and bounds to top n', async () => {
    const lo = await seedPost(env, { id: 'np-lo', content: { kind: 'generation' } })
    const hi = await seedPost(env, { id: 'np-hi', content: { kind: 'generation' } })
    const mid = await seedPost(env, { id: 'np-mid', content: { kind: 'generation' } })
    await humanVote(hi, 'anon-a', 1)
    await humanVote(hi, 'anon-b', 1)
    await humanVote(mid, 'anon-a', 1)
    await humanVote(lo, 'anon-a', 1)
    await humanVote(lo, 'anon-b', -1) // net 0

    const top2 = await getNicheGenePool(env, populist, 2)
    expect(top2).toEqual([
      { ref: PostId('np-hi'), fitness: 2 },
      { ref: PostId('np-mid'), fitness: 1 },
    ])
  })

  it('excludes non-succeeded generations and non-generation posts even when voted on', async () => {
    const ok = await seedPost(env, { id: 'np-ok', content: { kind: 'generation' } })
    const failed = await seedPost(env, {
      id: 'np-failed',
      content: { kind: 'generation', status: { kind: 'failed', reason: 'boom', failedAt: new Date('2026-01-01') } },
    })
    const found = await seedPost(env, { id: 'np-found', content: { kind: 'found' } })
    await vote(ok, ST_VIVIAN, 1)
    await vote(failed, ST_VIVIAN, 1)
    await vote(found, ST_VIVIAN, 1)

    const refs = (await getNicheGenePool(env, citizenNiche(ST_VIVIAN), 50)).map((c) => c.ref)
    expect(refs).toEqual([PostId('np-ok')])
  })

  it('returns [] when the niche has selected nothing (the bootstrap is the data)', async () => {
    await seedPost(env, { id: 'np-unvoted', content: { kind: 'generation' } })
    expect(await getNicheGenePool(env, citizenNiche(ST_VIVIAN), 50)).toEqual([])
  })
})

describe('getCitizenVoteCounts — niche-pick selection activity', () => {
  it('counts each cast voter\'s votes; a zero-activity citizen is simply absent', async () => {
    const p1 = await seedPost(env, { id: 'ac-1', content: { kind: 'generation' } })
    const p2 = await seedPost(env, { id: 'ac-2', content: { kind: 'generation' } })
    await vote(p1, ST_VIVIAN, 1)
    await vote(p2, ST_VIVIAN, -1) // a downvote is still selection ACTIVITY
    await vote(p1, GREMLIN, 1)
    await humanVote(p1, 'anon-h', 1) // human activity must NOT count toward a citizen

    const counts = await getCitizenVoteCounts(env, [ST_VIVIAN, GREMLIN, 'voter:silent'])
    expect(counts.get(ST_VIVIAN)).toBe(2)
    expect(counts.get(GREMLIN)).toBe(1)
    expect(counts.has('voter:silent')).toBe(false) // never voted → absent (read as 0)
  })

  it('returns an empty map for an empty cast (the inArray identity, no footgun)', async () => {
    expect(await getCitizenVoteCounts(env, [])).toEqual(new Map())
  })
})
