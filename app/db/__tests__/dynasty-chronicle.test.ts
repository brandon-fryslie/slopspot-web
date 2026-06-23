// [LAW:behavior-not-structure] The dynasty chronicle CONTRACT (slopspot-genome-p6z.6) over a REAL D1: a
// constructed bloodline past the dynasty threshold renders its founder honored, its drift across the
// generations (speciation values, deterministic), and its inbred crosses flagged with the Gremlin's
// spoken verdict — while a healthy outbred cross is NOT flagged. This is the ticket's machine-verifiable
// gate: data-level deterministic, no live LLM (the verdict renders from its floor).
//
// [LAW:one-source-of-truth] founder / drift / inbreeding are FOLDS over (lineage_edges + genome distance) —
// nothing is stored. The test seeds a breeding DAG + the Gremlin persona row and asserts the derived view.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { getDynastyChronicle } from '~/db/dynasty-chronicle'
import { db } from '~/db/client'
import { lineageEdges } from '~/db/schema'
import { DYNASTY_THRESHOLD } from '~/lib/genealogy'
import { GenomeId, PostId } from '~/lib/domain'
import { seedPost, seedVote } from './helpers'

// A second parent edge (seedPost's parentId seeds ONE; a bred node needs two).
async function breedEdge(child: PostId, parent: PostId) {
  await db(env).insert(lineageEdges).values({ childGenomeId: child, parentGenomeId: parent })
}

// The chronicle reads standing over a 14-day window pair anchored on the loader's clock; the tests
// pass a fixed NOW so the recent/prior split is deterministic, never the wall clock.
const NOW = new Date('2026-03-01T00:00:00Z').getTime()
const DAY = 24 * 60 * 60 * 1000

// `n` upvotes on a post at a fixed time, each from a distinct voter (the votes PK is (post_id, voter_id)),
// the same shape standing.test uses — net votes RECEIVED, the bloodline's reception currency.
async function upvotes(postId: PostId, n: number, at: Date, tag: string) {
  for (let i = 0; i < n; i++) {
    await seedVote(env, { postId, voterId: `voter:${tag}:${i}`, value: 1, createdAt: at })
  }
}

// The city's skeptic (agent:skeptic) — the Gremlin — is seeded by the persona migrations, so
// getDynastyChronicle resolves the real row to voice the inbreeding asides; the test adds no persona.

// FAR genes: differs from the photoreal/1:1/fal-flux default in three of the four genes (species, frame,
// medium) — exactly GENE_SWAP_THRESHOLD, so a node carrying these has speciated from a default-gene founder.
const FAR = { styleFamily: 'anime' as const, aspectRatio: '16:9' as const, providerId: 'replicate-sdxl' }

const G = (id: string) => `dc-${id}`

describe('getDynastyChronicle — the bloodline long game (genome-p6z.6)', () => {
  it('honors the founder, shows the drift, flags inbreeding, and spares a healthy cross', async () => {
    // F roots the whole bloodline. P1/P2 are identical default children (an inbred pair); Q carries FAR
    // genes; D is a drifted (speciated) descendant. INB = P1 × P2 (inbred); OUT = P1 × Q (healthy outbred).
    const f = await seedPost(env, { id: G('f'), content: { kind: 'generation' } })
    const a = await seedPost(env, { id: G('a'), content: { kind: 'generation', parentId: f } })
    const d = await seedPost(env, { id: G('d'), content: { kind: 'generation', parentId: a, ...FAR } })
    const p1 = await seedPost(env, { id: G('p1'), content: { kind: 'generation', parentId: f } })
    const p2 = await seedPost(env, { id: G('p2'), content: { kind: 'generation', parentId: f } })
    const q = await seedPost(env, { id: G('q'), content: { kind: 'generation', parentId: f, ...FAR } })

    const inb = await seedPost(env, { id: G('inb'), content: { kind: 'generation', parentId: p1 } })
    await breedEdge(inb, p2) // INB bred from the identical pair P1 × P2 → distance {0,0}

    const out = await seedPost(env, { id: G('out'), content: { kind: 'generation', parentId: p1 } })
    await breedEdge(out, q) // OUT bred from P1 × Q (FAR) → three genes apart, a healthy cross

    const chronicle = await getDynastyChronicle(env, f, NOW)

    // 1. FOUNDER HONOR — F is the one root, weighted by a line past the dynasty threshold. With no votes
    // seeded, the bloodline's reception arc is the honest STEADY (zero recent, zero prior — no drama).
    expect(chronicle.founders.map((x) => x.postId)).toEqual([f])
    expect(chronicle.founders[0]!.descendantCount).toBeGreaterThanOrEqual(DYNASTY_THRESHOLD)
    expect(chronicle.founders[0]!.standing).toBe('steady')

    // 2. DRIFT ACROSS GENERATIONS — every bloodline node carries a speciation verdict; the FAR descendant D
    // has drifted three genes from F and reads as a new species (deterministic values, no LLM).
    const driftById = new Map(chronicle.drift.map((x) => [x.postId, x]))
    expect(driftById.has(f)).toBe(true)
    const dDrift = driftById.get(d)!
    expect(dDrift.speciation.founders.find((s) => s.founder === GenomeId(f))!.distance.geneMismatches).toBe(3)
    expect(dDrift.speciation.isNewSpecies).toBe(true)
    // The founder is its own baseline — gen 0, no drift from itself.
    expect(driftById.get(f)!.depth).toBe(0)
    expect(driftById.get(f)!.speciation.isNewSpecies).toBe(false)

    // 3. INBREEDING FLAGGED + the Gremlin SPEAKS — INB is the only inbred cross; its verdict references it.
    expect(chronicle.inbred.map((x) => x.postId)).toEqual([inb])
    const inbredEntry = chronicle.inbred[0]!
    expect(inbredEntry.distance).toEqual({ geneMismatches: 0, traitDrift: 0 })
    expect(inbredEntry.remark.kind).toBe('spoke')
    if (inbredEntry.remark.kind === 'spoke') {
      expect(inbredEntry.remark.text.toLowerCase()).toContain('inbred')
    }

    // 4. A HEALTHY OUTBRED CROSS IS NOT FLAGGED — OUT (P1 × FAR Q) never appears in the inbreeding notices.
    expect(chronicle.inbred.map((x) => x.postId)).not.toContain(out)
  })

  it('an unknown post (no genome) yields an empty chronicle, not a throw', async () => {
    const chronicle = await getDynastyChronicle(env, PostId('ds-nonexistent'), NOW)
    expect(chronicle).toEqual({ founders: [], drift: [], inbred: [] })
  })

  // genome-p6z.7 — the bloodline's reception arc. Standing is read over the founder's WHOLE line (the
  // founder + its descendants, the same scope descendantCount measures), split into the recent window
  // against the prior. A line whose reception surges reads ASCENDANT; one that collapses reads FADING —
  // the SAME arc the roll call gives a citizen, voiced for a dynasty. [LAW:behavior-not-structure] the
  // assertion is on the derived Standing, not on how it was folded.
  it('reads a bloodline ASCENDANT when its recent reception outpaces the prior window', async () => {
    const S = (id: string) => `ds-asc-${id}`
    const f = await seedPost(env, { id: S('f'), content: { kind: 'generation' } })
    const a = await seedPost(env, { id: S('a'), content: { kind: 'generation', parentId: f } })

    // The line drew 1 vote in the prior window and 7 in the recent — a clear surge (delta 6 clears the
    // floor of 3). Votes land across the founder AND its descendant, so the arc is the LINE's, not one post's.
    await upvotes(f, 1, new Date(NOW - 20 * DAY), 'asc-prior')
    await upvotes(f, 4, new Date(NOW - 3 * DAY), 'asc-recent-f')
    await upvotes(a, 3, new Date(NOW - 2 * DAY), 'asc-recent-a')

    const chronicle = await getDynastyChronicle(env, f, NOW)
    expect(chronicle.founders.map((x) => x.postId)).toEqual([f])
    expect(chronicle.founders[0]!.standing).toBe('ascendant')
  })

  it('reads a bloodline FADING when its recent reception collapses below the prior window', async () => {
    const S = (id: string) => `ds-fade-${id}`
    const f = await seedPost(env, { id: S('f'), content: { kind: 'generation' } })
    const a = await seedPost(env, { id: S('a'), content: { kind: 'generation', parentId: f } })

    // The mirror: 8 votes in the prior window, 1 in the recent — a collapse (delta -7 clears the floor).
    await upvotes(f, 5, new Date(NOW - 22 * DAY), 'fade-prior-f')
    await upvotes(a, 3, new Date(NOW - 18 * DAY), 'fade-prior-a')
    await upvotes(f, 1, new Date(NOW - 2 * DAY), 'fade-recent')

    const chronicle = await getDynastyChronicle(env, f, NOW)
    expect(chronicle.founders.map((x) => x.postId)).toEqual([f])
    expect(chronicle.founders[0]!.standing).toBe('fading')
  })
})
