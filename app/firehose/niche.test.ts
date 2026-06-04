import { describe, expect, it } from 'vitest'
import { chooseNiche, NICHE_BASE_WEIGHT } from '~/firehose/niche'

// [LAW:behavior-not-structure] The pure niche-pick's contract: an active critic is picked more
// (selection pressure radiates), the crowd is ONE peer normalized to MEAN citizen activity (its
// raw volume can never dominate the cross-niche pick — the monoculture guard), an all-quiet city
// draws uniformly, and the pick is a reproducible function of (cast, activity, seed).

const SEEDS = Array.from({ length: 6000 }, (_, i) => i)

function tally(citizens: string[], activity: Map<string, number>) {
  const counts = new Map<string, number>()
  for (const seed of SEEDS) {
    const niche = chooseNiche(citizens, activity, seed)
    const key = niche.kind === 'populist' ? '@populist' : niche.voterId
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

describe('chooseNiche — the niche-pick fold', () => {
  it('always offers the populist as a peer and picks only real niches', () => {
    const counts = tally(['vivian', 'gremlin'], new Map([['vivian', 4], ['gremlin', 2]]))
    expect([...counts.keys()].sort()).toEqual(['@populist', 'gremlin', 'vivian'])
  })

  it('weights citizens by selection activity — the more active critic is picked more', () => {
    const counts = tally(['active', 'quiet'], new Map([['active', 20], ['quiet', 0]]))
    expect((counts.get('active') ?? 0)).toBeGreaterThan((counts.get('quiet') ?? 0) * 3)
  })

  it('GUARD: the populist is one peer at MEAN citizen activity — never the raw human volume', () => {
    // Citizens 8, 4, 0 → mean 4. A 4th citizen pinned at exactly the mean (4) is the populist's
    // twin: both carry weight BASE+4, so they must be picked about equally. Crucially, NO human
    // vote count enters this — the crowd cannot out-weigh the cast by sheer volume.
    const citizens = ['hi', 'mid', 'lo', 'twin']
    const activity = new Map([['hi', 8], ['mid', 4], ['lo', 0], ['twin', 4]])
    const counts = tally(citizens, activity)

    const populist = counts.get('@populist') ?? 0
    const twin = counts.get('twin') ?? 0
    // Populist (BASE + mean=4) ≈ twin (BASE + 4): within 15% of each other.
    expect(Math.abs(populist - twin) / twin).toBeLessThan(0.15)
    // And both sit below the most-active citizen (BASE + 8).
    expect(counts.get('hi') ?? 0).toBeGreaterThan(populist)
  })

  it('draws uniformly when no one has voted yet (base floor, the bootstrap is the data)', () => {
    const counts = tally(['a', 'b', 'c'], new Map())
    // 3 citizens + populist, all at NICHE_BASE_WEIGHT → ~1/4 each.
    for (const key of ['a', 'b', 'c', '@populist']) {
      const frac = (counts.get(key) ?? 0) / SEEDS.length
      expect(frac).toBeGreaterThan(0.18)
      expect(frac).toBeLessThan(0.32)
    }
    expect(NICHE_BASE_WEIGHT).toBeGreaterThan(0)
  })

  it('with no cast at all, the populist is the only niche', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      expect(chooseNiche([], new Map(), seed)).toEqual({ kind: 'populist', citizenVoterIds: [] })
    }
  })

  it('is a reproducible function of (cast, activity, seed)', () => {
    const citizens = ['x', 'y', 'z']
    const activity = new Map([['x', 3], ['y', 7], ['z', 1]])
    for (const seed of SEEDS.slice(0, 500)) {
      expect(chooseNiche(citizens, activity, seed)).toEqual(chooseNiche(citizens, activity, seed))
    }
  })
})
