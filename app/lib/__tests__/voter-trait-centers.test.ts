// [LAW:verifiable-goals] The SELECTION-side breadth guard made checkable (slopspot-genome-1l7). genome-3un
// (founder-traits.test) proves the MAKERS span — GutterMonk owns the austere/sparse VOID pole. This suite
// proves the CRITICS who VOTE on that work have at least one genuine CHAMPION of the void, so the austere
// pieces are not downvoted into invisibility and the range dies on the feed despite the makers having it.
//
// THE CONTRACT a blind reader could check:
//   (a) BOTH poles have a champion — at least one voter LOVES the void (LOW austerity AND LOW density,
//       the pole GutterMonk owns at 0.12/0.10 → The Formalist) AND at least one LOVES the baroque (HIGH
//       austerity AND HIGH density, the pole Vesper owns → The Gremlin). A void champion alone would
//       over-correct into the opposite monoculture; breadth is the SPAN between two loved poles.
//   (b) the inversion is CORRECTED — The Formalist, whose creed opens "austere... contempt for the
//       maximalist mess", sits AUSTERE (austerity < 0.5) as its creed demands, not at the inverted
//       baroque 0.75 migration 0030 mistakenly wrote.
//   (c) the pool SPANS taste — it is not a monoculture clustered at one pole on the void axes.
//
// [LAW:one-source-of-truth] The voter centers are AUTHORED in migrations 0030 (the seven voters),
// 0037 (The Formalist's void retune + The Gremlin's baroque retune, both OVERRIDING their 0030 rows),
// and 0038 (The Lorekeeper + The Populist — the two never-tuned voters, seated to fill the CLEAN pole).
// This suite READS that SQL as its source — it does not re-declare the numbers — so a CD retune of any
// migration is verified here automatically and they can never drift. Same axis directions as
// register.ts: austerity 0=austere, density 0=sparse, curse 0=clean, earnestness 0=ironic — so the void
// pole is the LOW-austerity/LOW-density corner, the baroque pole the HIGH-austerity (ornate) end, the
// cursed pole the HIGH-curse end, and the clean pole the LOW-curse end.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { TraitVector } from '~/lib/domain'
import { traitVectorSchema, TRAIT_AXES } from '~/lib/traits'

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../drizzle/${rel}`, import.meta.url)), 'utf8')

// Every `UPDATE personas SET traits_json = '<json>' WHERE agent_id = '<id>'` becomes one (id → vector)
// entry, validated through the same strict storage-boundary parser the runtime read uses — a malformed
// or out-of-range center in the migration fails THIS suite, loud. Later files override earlier ones, so
// 0037's Formalist retune wins over its 0030 row exactly as the applied migrations resolve it.
const parseCenters = (sql: string, into: Map<string, TraitVector>): void => {
  const re = /traits_json\s*=\s*'(\{[^']*\})'\s*WHERE\s+agent_id\s*=\s*'([^']+)'/g
  for (const m of sql.matchAll(re)) {
    into.set(m[2], traitVectorSchema.parse(JSON.parse(m[1])))
  }
}

const CENTERS = (() => {
  const out = new Map<string, TraitVector>()
  parseCenters(read('0030_personas_traits.sql'), out) // the seven voter centers
  parseCenters(read('0037_formalist_void_lover.sql'), out) // The Formalist's void retune (override)
  parseCenters(read('0038_clean_pole_voters.sql'), out) // The Lorekeeper + The Populist (the clean pole)
  return out
})()

const FORMALIST = 'agent:aesthete'
const GREMLIN = 'agent:skeptic'
const MORTICIAN = 'agent:cursed-one'
const LOREKEEPER = 'agent:lore-keeper'
// The Populist's stable key is agent:basic-bitch — NOT "agent:populist", which does not exist (see 0038).
const POPULIST = 'agent:basic-bitch'

// A void-lover reaches for the austere/sparse pole GutterMonk owns; a baroque-lover for the ornate/dense
// pole Vesper owns. 0.4 / 0.6 are generous "clearly leaning" lines either side of the 0.5 mid.
const isVoidLover = (t: TraitVector): boolean => t.austerity < 0.4 && t.density < 0.4
const isBaroqueLover = (t: TraitVector): boolean => t.austerity > 0.6 && t.density > 0.6
// The BAROQUE generator pole is the ornate end of the austerity axis (register.ts: 1 = baroque/ornate).
// A baroque champion need not also be dense — The Populist is baroque-CLEAN (lush, austerity 0.65) but
// sits just at the density mid, so the baroque-pole predicate is austerity alone, not the void-axis pair.
const isBaroqueChampion = (t: TraitVector): boolean => t.austerity > 0.6
// The rare SINCERE + CLEAN voter — champions IDRIS's worldbuilding (intentional worlds, not glitch):
// earnest devotion (no ironic mask) toward clean, story-bearing images. This region was empty before
// 0038 (every other sincere voter loves the cursed), so the predicate resolves uniquely to The Lorekeeper.
const isWorldbuildingChampion = (t: TraitVector): boolean => t.earnestness > 0.7 && t.curse < 0.4
const idsWhere = (pred: (t: TraitVector) => boolean): string[] =>
  [...CENTERS.entries()].filter(([, t]) => pred(t)).map(([id]) => id)
const maxBy = (axis: keyof TraitVector): string =>
  [...CENTERS.entries()].reduce((hi, e) => (e[1][axis] > hi[1][axis] ? e : hi))[0]

describe('voter trait centers — the selection-side breadth guard', () => {
  it('parses every voter center from the migrations', () => {
    // Seven seeded voters get an explicit 0030 center; 0037 retunes two of them (no new ids); 0038 seats
    // the two never-tuned voters (The Lorekeeper + The Populist) → nine distinct centers in all.
    expect(CENTERS.size).toBe(9)
    expect(CENTERS.has(FORMALIST)).toBe(true)
    expect(CENTERS.has(LOREKEEPER)).toBe(true)
    expect(CENTERS.has(POPULIST)).toBe(true)
  })

  it('(a) BOTH poles have a champion — a void-lover AND a baroque-lover', () => {
    const voidLovers = [...CENTERS.entries()].filter(([, t]) => isVoidLover(t))
    const baroqueLovers = [...CENTERS.entries()].filter(([, t]) => isBaroqueLover(t))
    // The headline guard: GutterMonk's austere/sparse work has a champion (The Formalist)...
    expect(voidLovers.length).toBeGreaterThanOrEqual(1)
    expect(voidLovers.map(([id]) => id)).toContain(FORMALIST)
    // ...and Vesper's maximalism has one too (The Gremlin) — breadth is the span between loved poles.
    expect(baroqueLovers.length).toBeGreaterThanOrEqual(1)
    expect(baroqueLovers.map(([id]) => id)).toContain(GREMLIN)
  })

  it('(b) the Formalist sits AUSTERE — the 0030 austerity inversion is corrected', () => {
    const formalist = CENTERS.get(FORMALIST)
    expect(formalist).toBeDefined()
    // Creed: "austere, exacting... contempt for the maximalist mess." austere = LOW austerity
    // (register.ts). The inverted 0030 value was 0.75 (baroque); the corrected center is austere.
    expect(formalist!.austerity).toBeLessThan(0.5)
    expect(formalist!.density).toBeLessThan(0.5)
  })

  it('(c) the pool SPANS the void axes — not a monoculture at one pole', () => {
    for (const axis of ['austerity', 'density'] as const) {
      const values = [...CENTERS.values()].map((t) => t[axis])
      // A real range on each void axis: someone austere/sparse AND someone toward the baroque/dense end.
      expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.3)
    }
  })

  it('(d) the CLEAN pole is now occupied — curse SPANS clean ↔ cursed', () => {
    // Before 0038 the clean end of the curse axis was nearly empty (every sincere voter loved the
    // cursed; only The Formalist leaned clean, bundled with the void). 0038 fills it: three voters now
    // lean clean (curse < 0.4) — The Populist (THE clean champion), The Lorekeeper, The Formalist — and
    // The Mortician still anchors the cursed end, so the axis spans instead of clustering.
    const cleanLeaning = idsWhere((t) => t.curse < 0.4)
    expect(cleanLeaning).toEqual(expect.arrayContaining([POPULIST, LOREKEEPER, FORMALIST]))
    expect(maxBy('curse')).toBe(MORTICIAN) // the cursed end is anchored by its patron
    const curses = [...CENTERS.values()].map((t) => t.curse)
    expect(Math.max(...curses) - Math.min(...curses)).toBeGreaterThan(0.5)
  })

  it('(e) all four axes span — the critic pool is not a monoculture on any axis', () => {
    for (const axis of TRAIT_AXES) {
      const values = [...CENTERS.values()].map((t) => t[axis])
      expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.5)
    }
  })

  it('(f) every generator pole has a voter champion — the feed loves what the makers span', () => {
    // genome-3un gave the GENERATORS spanning regions; a pole nobody VOTES for dies on the feed. Each
    // generator pole the cast spans must have at least one critic who reaches for it.
    expect(idsWhere(isVoidLover)).toContain(FORMALIST) // void (austere/sparse) → The Formalist
    // baroque (ornate) → BOTH The Gremlin (baroque-cursed) and The Populist (baroque-clean)
    expect(idsWhere(isBaroqueChampion)).toEqual(expect.arrayContaining([GREMLIN, POPULIST]))
    expect(maxBy('curse')).toBe(MORTICIAN) // cursed → The Mortician, patron of the cursed
    expect(idsWhere(isWorldbuildingChampion)).toEqual([LOREKEEPER]) // worldbuilding → The Lorekeeper
  })

  it('every center is a valid, in-range trait vector on exactly the four axes', () => {
    for (const [, t] of CENTERS) {
      for (const axis of TRAIT_AXES) {
        expect(t[axis]).toBeGreaterThanOrEqual(0)
        expect(t[axis]).toBeLessThanOrEqual(1)
      }
    }
  })
})
