import { describe, expect, it } from 'vitest'
import { ProviderId } from '~/lib/domain'
import type { RecentRecipe } from '~/db/recent'
import { getProvider } from '~/providers'
import { STYLE_FAMILIES } from '~/lib/variety'
import type { FitnessCandidate } from '~/db/genepool'
import { PostId } from '~/lib/domain'
import { seedHash } from '~/lib/hash'
import { chooseNextGeneration } from './chooseNextGeneration'
import { selectReproduction } from './select'
import { DRIFT_FLOOR_CAP, dominantFamily, driftFloor, monoculturePressure } from './drift-floor'

// [LAW:behavior-not-structure] These pin the drift floor's CONTRACT: the share→weight
// transform, the breeder's pressure complement, and the systemic guarantee — over a seeded
// simulation of many fires against an adversarial all-fox gene pool, no phenotype family
// runs away with the recent pool. The simulation is the ticket's machine-verifiable
// acceptance (slopspot-genome-gdm), run in pure code (no D1): the chooser and the selection
// fold are both pure, so threading `recent` forward across N fires IS N cron fires.

const PROVIDER = getProvider(ProviderId('fal-flux'))

function makeRecent(overrides: Partial<RecentRecipe> = {}): RecentRecipe {
  return {
    postId: PostId('p-recent'),
    providerId: ProviderId('fal-flux'),
    styleFamily: 'photoreal',
    subjectTemplate: 'T01',
    slots: { animal: 'cat', profession: 'surgeon' },
    aspectRatio: '1:1',
    ...overrides,
  }
}

describe('driftFloor — the share→weight transform', () => {
  it('is a strict no-op (1.0) on an empty window — bootstrap = steady-state', () => {
    expect(driftFloor(0, 0)).toBe(1)
  })

  it('is a no-op while a family stays below half the cap', () => {
    // relax point = cap/2. A share at/under it draws at full weight.
    const total = 100
    expect(driftFloor(Math.floor((DRIFT_FLOOR_CAP / 2) * total), total)).toBe(1)
    expect(driftFloor(1, total)).toBe(1)
  })

  it('drives the weight to 0 at and above the cap', () => {
    const total = 100
    expect(driftFloor(Math.ceil(DRIFT_FLOOR_CAP * total), total)).toBe(0)
    expect(driftFloor(total, total)).toBe(0)
  })

  it('ramps monotonically down between the relax point and the cap', () => {
    const total = 1000
    const lo = driftFloor(Math.round(0.2 * total), total)
    const mid = driftFloor(Math.round(0.25 * total), total)
    const hi = driftFloor(Math.round(0.3 * total), total)
    expect(lo).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(hi)
    expect(lo).toBeLessThanOrEqual(1)
    expect(hi).toBeGreaterThanOrEqual(0)
  })
})

describe('monoculturePressure — the breeder lever', () => {
  it('is 0 on an empty window and on a varied full window', () => {
    expect(monoculturePressure([])).toBe(0)
    // A realistic full window (20) spread so no animal or style holds more than the
    // relax share — the healthy steady state the floor must leave untouched.
    const animals = ['cat', 'fox', 'owl', 'hare', 'raven', 'otter', 'badger', 'heron', 'donkey', 'magpie']
    const varied: RecentRecipe[] = Array.from({ length: 20 }, (_, i) =>
      makeRecent({
        styleFamily: STYLE_FAMILIES[i % STYLE_FAMILIES.length],
        slots: { animal: animals[i % animals.length]! },
      }),
    )
    expect(monoculturePressure(varied)).toBe(0)
  })

  it('reaches 1 when one family saturates the window (the Year of the Fox)', () => {
    const allFox: RecentRecipe[] = Array.from({ length: 20 }, () =>
      makeRecent({ slots: { animal: 'fox' } }),
    )
    expect(monoculturePressure(allFox)).toBe(1)
  })

  it('is the exact complement of the floor for the dominant family', () => {
    // 8 foxes in 20 (share 0.4 ≥ cap) → floor 0 → pressure 1.
    const recent: RecentRecipe[] = [
      ...Array.from({ length: 8 }, () => makeRecent({ slots: { animal: 'fox' } })),
      ...Array.from({ length: 12 }, () => makeRecent({ slots: { animal: 'owl' } })),
    ]
    expect(monoculturePressure(recent)).toBe(1 - driftFloor(8, 20))
  })
})

describe('dominantFamily — the convergence reading (slopspot-genome-brs)', () => {
  it('is null on an empty window — nothing has converged, the Noticing has nothing to remark on', () => {
    expect(dominantFamily([])).toBeNull()
  })

  it('reports the over-represented ANIMAL family, its count, and a representative slop', () => {
    // 6 foxes + 4 owls, each fox a distinct post; styles spread so animal is the converged axis.
    const recent: RecentRecipe[] = [
      ...Array.from({ length: 6 }, (_, i) =>
        makeRecent({
          postId: PostId(`fox-${i}`),
          styleFamily: STYLE_FAMILIES[i % STYLE_FAMILIES.length],
          slots: { animal: 'fox' },
        }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        makeRecent({
          postId: PostId(`owl-${i}`),
          styleFamily: STYLE_FAMILIES[(i + 1) % STYLE_FAMILIES.length],
          slots: { animal: 'owl' },
        }),
      ),
    ]
    const dom = dominantFamily(recent)
    expect(dom).toMatchObject({ axis: 'animal', label: 'fox', count: 6 })
    // The representative is the NEWEST member of the family — recent[0], the first fox.
    expect(dom?.representative).toBe('fox-0')
  })

  it('reads the STYLE axis when a style saturates harder than any animal', () => {
    // Every row liminal (10), animals all distinct (count 1 each) → style is the dominant family.
    const recent: RecentRecipe[] = Array.from({ length: 10 }, (_, i) =>
      makeRecent({ postId: PostId(`p-${i}`), styleFamily: 'liminal', slots: { animal: `a${i}` } }),
    )
    expect(dominantFamily(recent)).toMatchObject({ axis: 'style', label: 'liminal', count: 10 })
  })

  it('prefers the ANIMAL axis on a tie — the visible convergence the doctrine names', () => {
    // 3 foxes and 3 of one style, equal counts → animal wins the tie.
    const recent: RecentRecipe[] = [
      ...Array.from({ length: 3 }, (_, i) =>
        makeRecent({ postId: PostId(`fox-${i}`), styleFamily: STYLE_FAMILIES[i]!, slots: { animal: 'fox' } }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        makeRecent({ postId: PostId(`other-${i}`), styleFamily: 'vaporwave', slots: { animal: `z${i}` } }),
      ),
    ]
    // animal 'fox' count 3 ties style 'vaporwave' count 3 → animal preferred.
    expect(dominantFamily(recent)).toMatchObject({ axis: 'animal', label: 'fox', count: 3 })
  })

  it('agrees with monoculturePressure — one reading, the scalar is its projection', () => {
    const allFox: RecentRecipe[] = Array.from({ length: 20 }, (_, i) =>
      makeRecent({ postId: PostId(`fox-${i}`), slots: { animal: 'fox' } }),
    )
    const dom = dominantFamily(allFox)
    expect(dom).not.toBeNull()
    expect(monoculturePressure(allFox)).toBe(1 - driftFloor(dom!.count, allFox.length))
  })
})

// The ticket's headline acceptance: a seeded N-fire simulation where the gene pool is
// ADVERSARIAL — every breedable candidate is a fox, so every bred fire conserves the fox
// (breed.ts inherits genes.form wholesale). Without the drift floor, ~80% of fires breed
// (FOUNDER_RATE 0.2) and the feed goes fully vulpine. With it, the two mechanisms compose:
// the breeder founds more as the pool converges, and the chooser's R7 keeps those founders
// off the dominant family. The fox share must settle well below the cap.
describe('drift floor — adversarial N-fire simulation (the Year of the Fox)', () => {
  const BASE_T = Date.UTC(2026, 0, 1, 0, 0, 0)
  const SIX_HOURS = 6 * 60 * 60 * 1000
  const WINDOW = 20
  const N = 4000

  // The adversarial pool: ≥2 breedable fox genomes, so canBreed is always true and the only
  // thing standing between the city and a fox monoculture is the drift floor.
  const FOX_POOL: FitnessCandidate[] = [
    { ref: PostId('fox-a'), fitness: 10 },
    { ref: PostId('fox-b'), fitness: 8 },
  ]

  function run(useFloor: boolean): RecentRecipe[][] {
    const windows: RecentRecipe[][] = []
    let recent: RecentRecipe[] = []
    for (let i = 0; i < N; i++) {
      const t = BASE_T + i * SIX_HOURS
      // The breeder lever: 0 when the floor is disabled (baseline), the real pressure otherwise.
      const pressure = useFloor ? monoculturePressure(recent) : 0
      const plan = selectReproduction(FOX_POOL, seedHash(t, 'reproduce'), pressure)
      let row: RecentRecipe
      if (plan.kind === 'bred') {
        // breed conserves genes.form (and here species) wholesale → another fox.
        row = makeRecent({ styleFamily: 'photoreal', slots: { animal: 'fox' } })
      } else {
        const r = chooseNextGeneration({ scheduledTimeMs: t, recent, provider: PROVIDER })
        row = {
          postId: PostId(`sim-${i}`),
          providerId: r.providerId,
          styleFamily: r.styleFamily,
          subjectTemplate: r.subject.subjectTemplate,
          slots: r.subject.slots as Record<string, string>,
          aspectRatio: r.aspectRatio,
        }
      }
      recent = [row, ...recent].slice(0, WINDOW)
      if (recent.length === WINDOW) windows.push(recent)
    }
    return windows
  }

  function foxShare(window: RecentRecipe[]): number {
    return window.filter((r) => r.slots['animal'] === 'fox').length / window.length
  }

  it('holds the dominant family below the cap; the baseline (no floor) runs away', () => {
    const floored = run(true)
    const baseline = run(false)

    // Steady state = the back half of the run, past any warm-up transient.
    const backHalf = (ws: RecentRecipe[][]) => ws.slice(Math.floor(ws.length / 2))
    const mean = (ws: RecentRecipe[][]) =>
      ws.reduce((s, w) => s + foxShare(w), 0) / ws.length

    const flooredMean = mean(backHalf(floored))
    const baselineMean = mean(backHalf(baseline))
    const flooredMax = Math.max(...backHalf(floored).map(foxShare))

    // The systemic guarantee: the steady-state fox share sits at/under the cap, and no
    // single screenful overshoots it by much (transient slack only).
    expect(flooredMean).toBeLessThanOrEqual(DRIFT_FLOOR_CAP)
    expect(flooredMax).toBeLessThanOrEqual(DRIFT_FLOOR_CAP + 0.15)

    // And it is doing real work: the baseline (no floor) lets the fox eat the feed.
    expect(baselineMean).toBeGreaterThan(0.7)
    expect(flooredMean).toBeLessThan(baselineMean * 0.6)
  })
})
