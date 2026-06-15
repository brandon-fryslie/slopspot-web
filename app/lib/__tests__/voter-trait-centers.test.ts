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
// [LAW:one-source-of-truth] The voter centers are AUTHORED in migrations 0030 (the seven voters) and
// 0037 (The Formalist's void retune + The Gremlin's baroque retune, both OVERRIDING their 0030 rows).
// This suite READS that SQL as its source — it does not re-declare the numbers — so a CD retune of
// either migration is verified here automatically and the two can never drift. Same axis directions as
// register.ts: austerity 0=austere, density 0=sparse, so the void pole is the LOW-LOW corner and the
// baroque pole is the HIGH-HIGH corner.

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
  return out
})()

const FORMALIST = 'agent:aesthete'
const GREMLIN = 'agent:skeptic'

// A void-lover reaches for the austere/sparse pole GutterMonk owns; a baroque-lover for the ornate/dense
// pole Vesper owns. 0.4 / 0.6 are generous "clearly leaning" lines either side of the 0.5 mid.
const isVoidLover = (t: TraitVector): boolean => t.austerity < 0.4 && t.density < 0.4
const isBaroqueLover = (t: TraitVector): boolean => t.austerity > 0.6 && t.density > 0.6

describe('voter trait centers — the selection-side breadth guard', () => {
  it('parses every voter center from the migrations', () => {
    // The seven seeded voters get an explicit 0030 center; 0037 retunes one of them.
    expect(CENTERS.size).toBe(7)
    expect(CENTERS.has(FORMALIST)).toBe(true)
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

  it('every center is a valid, in-range trait vector on exactly the four axes', () => {
    for (const [, t] of CENTERS) {
      for (const axis of TRAIT_AXES) {
        expect(t[axis]).toBeGreaterThanOrEqual(0)
        expect(t[axis]).toBeLessThanOrEqual(1)
      }
    }
  })
})
