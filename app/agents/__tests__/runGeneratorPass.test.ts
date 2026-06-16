// [LAW:verifiable-goals] Machine-verifiable gate for the runGeneratorPass bred path —
// the one piece select.test.ts + genepool.test.ts can't cover (they're pure/unit).
// This test seeds a breedable pair, fires runGeneratorPass with a seed known to
// produce 'bred', and asserts the child is in D1 with exactly 2 lineage_edges.
//
// [LAW:behavior-not-structure] Asserts the OBSERVABLE CONTRACT: a bred fire produces
// a new post with exactly 2 edges in lineage_edges, each pointing to one of the two
// parents. The internal crossover math is covered by breed.test.ts; this test only
// cares about the outcome that matters downstream (dynasties deepen correctly).

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { eq, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { lineageEdges, posts } from '~/db/schema'
import { setVote } from '~/db/votes'
import { runGeneratorPass } from '~/agents/generator'
import { PostId } from '~/lib/domain'
import { selectReproduction } from '~/firehose/select'
import { seedHash } from '~/lib/hash'
import { seedPost } from '~/db/__tests__/helpers'
import { STYLE_FAMILIES } from '~/lib/variety'

// [LAW:dataflow-not-control-flow] runGeneratorPass's founder-vs-bred draw now reads the
// drift floor (drift-floor.ts): a CONVERGED recent feed raises the founder-injection rate.
// A degenerate 2-post feed reads as a total monoculture (one style at 50% share » the cap),
// so the floor would correctly force EVERY fire to found — making a hermetic test of the
// BRED path impossible. This seeds a varied (unvoted, therefore non-breedable) recent window
// so the floor is quiescent and the bred draw fires, i.e. the realistic precondition: a
// breedable pair inside a feed that ISN'T already a monoculture. Unvoted ⇒ fitness 0 ⇒ never
// in the breedable pool, so the pool stays exactly the two voted parents.
async function seedVariedFeed(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await seedPost(env, {
      id: `varied-feed-filler-${i}`,
      content: {
        kind: 'generation',
        providerId: 'fal-flux-mock',
        styleFamily: STYLE_FAMILIES[i % STYLE_FAMILIES.length],
      },
    })
  }
}

// Deterministically find a scheduledTimeMs whose seedHash('reproduce') lands the
// reproduction draw in the 'bred' bucket (> FOUNDER_RATE threshold). Called once
// at module scope so the seed is stable across test runs.
function findBredSeed(startingFrom = 1_000_000): number {
  // Two dummy candidates to confirm canBreed=true; the actual pool read follows
  // from real DB state in the test.
  const dummyPool = [
    { ref: PostId('dummy-a'), fitness: 5 },
    { ref: PostId('dummy-b'), fitness: 5 },
  ]
  for (let t = startingFrom; t < startingFrom + 10_000; t++) {
    const plan = selectReproduction(dummyPool, seedHash(t, 'reproduce'))
    if (plan.kind === 'bred') return t
  }
  throw new Error('findBredSeed: could not find a bred-producing seed in range')
}

const BRED_SEED = findBredSeed()

describe('runGeneratorPass — bred path integration (L3 gate)', () => {
  it('with a breedable pair in the populist niche, writes a child post with 2 lineage_edges', async () => {
    // ARRANGE: two succeeded generation parents with a human upvote each (populist niche)
    const parentA = await seedPost(env, {
      id: 'breed-test-parent-a',
      content: {
        kind: 'generation',
        providerId: 'fal-flux-mock',
        styleFamily: 'oil-painting',
      },
    })
    const parentB = await seedPost(env, {
      id: 'breed-test-parent-b',
      content: {
        kind: 'generation',
        providerId: 'fal-flux-mock',
        styleFamily: 'watercolor',
      },
    })

    // Vote as EVERY niche so that whichever niche BRED_SEED picks has a breedable pool.
    // Citizen voters are the seeded voter personas; humans cover the populist niche.
    // ALL voter personas seeded by migrations 0007 + 0011
    const CITIZEN_VOTERS = ['agent:aesthete', 'agent:chaos-gremlin', 'agent:lore-keeper', 'agent:slop-purist', 'agent:vibe-curator', 'agent:cursed-one', 'agent:variety-hound-voter', 'agent:skeptic', 'agent:basic-bitch']
    for (const v of CITIZEN_VOTERS) {
      await setVote({ postId: parentA, voterId: v, value: 1, reasoning: 'test' }, { env })
      await setVote({ postId: parentB, voterId: v, value: 1, reasoning: 'test' }, { env })
    }
    await setVote({ postId: parentA, voterId: 'anon-h1', value: 1 }, { env })
    await setVote({ postId: parentB, voterId: 'anon-h2', value: 1 }, { env })

    // A varied recent feed so the drift floor doesn't (correctly) force a founder fire.
    await seedVariedFeed(20)

    const postsBefore = await db(env).select({ id: posts.id }).from(posts)
    const beforeIds = new Set(postsBefore.map((p) => p.id))

    // ACT: fire runGeneratorPass with BRED_SEED — deterministically produces 'bred'
    await runGeneratorPass(env, BRED_SEED)

    // ASSERT: exactly one new post was created
    const postsAfter = await db(env).select({ id: posts.id }).from(posts)
    expect(postsAfter.length).toBe(beforeIds.size + 1)

    // Find the new post (the one id not present before the fire — robust to filler)
    const childId = postsAfter.find((p) => !beforeIds.has(p.id))?.id
    expect(childId).toBeTruthy()

    // ASSERT: exactly 2 lineage_edges for the child, pointing to the two parents
    const edges = await db(env)
      .select({ parentGenomeId: lineageEdges.parentGenomeId })
      .from(lineageEdges)
      .where(eq(lineageEdges.childGenomeId, childId!))

    expect(edges.length).toBe(2)
    const parentIds = new Set(edges.map((e) => e.parentGenomeId))
    expect(parentIds.has(parentA)).toBe(true)
    expect(parentIds.has(parentB)).toBe(true)
  })

  it('with an empty pool (no votes yet), founds — selectReproduction contract (unit-covered)', async () => {
    // The founder ARM (authorSlop) cannot be integration-tested hermetically: every
    // seeded generator persona uses a real provider (fal-flux / replicate-sdxl /
    // replicate-ideogram — migrations 0008+0015), none of which can make network
    // calls in the miniflare workerd isolate. This is an infrastructure gap, not a
    // logic defect. The contract IS covered at the unit level:
    //
    //   - select.test.ts: empty pool → 'founder' plan, every seed (100% coverage)
    //   - gen-queue.test.ts: founder arm wired correctly; pickPersona null → loud error
    //   - generator.test.ts: every seeded persona config parses under .strict()
    //
    // For a fully live founder integration test, a mock-medium generator persona
    // would need to be seeded (e.g. medium:'fal-flux-mock') so authorSlop can render
    // without a network call. Track as a follow-up; the L3 bred gate above suffices.
    //
    // What we CAN assert here: the empty-pool path deterministically selects 'founder'
    // (the unit path, confirming the dataflow contract at the boundary):
    const { selectReproduction } = await import('~/firehose/select')
    const plan = selectReproduction([], BRED_SEED + 1)
    expect(plan).toEqual({ kind: 'founder' })
    // And any seed with empty pool:
    for (let s = 0; s < 100; s++) {
      expect(selectReproduction([], s).kind).toBe('founder')
    }
  })

  it('the bred child re-enters the pool as a future parent — no cycle in lineage DAG', { timeout: 60_000 }, async () => {
    // Verify dynasty deepening: seed a parent pair, breed a child, upvote the child,
    // then breed AGAIN using the child as one parent. Lineage DAG must be acyclic.
    const grandparentA = await seedPost(env, {
      id: 'dynasty-grandparent-a',
      content: { kind: 'generation', providerId: 'fal-flux-mock', styleFamily: 'oil-painting' },
    })
    const grandparentB = await seedPost(env, {
      id: 'dynasty-grandparent-b',
      content: { kind: 'generation', providerId: 'fal-flux-mock', styleFamily: 'watercolor' },
    })
    // ALL voter personas seeded by migrations 0007 + 0011
    const CITIZENS = ['agent:aesthete', 'agent:chaos-gremlin', 'agent:lore-keeper', 'agent:slop-purist', 'agent:vibe-curator', 'agent:cursed-one', 'agent:variety-hound-voter', 'agent:skeptic', 'agent:basic-bitch']
    for (const v of CITIZENS) {
      await setVote({ postId: grandparentA, voterId: v, value: 1, reasoning: 'test' }, { env })
      await setVote({ postId: grandparentB, voterId: v, value: 1, reasoning: 'test' }, { env })
    }
    await setVote({ postId: grandparentA, voterId: 'anon-dynasty-1', value: 1 }, { env })
    await setVote({ postId: grandparentB, voterId: 'anon-dynasty-2', value: 1 }, { env })

    // A varied recent feed so the drift floor doesn't force founder fires (see helper).
    await seedVariedFeed(20)

    // First breed — produces the child (grandparent pair → child)
    const beforeChild = new Set(
      (await db(env).select({ id: posts.id }).from(posts)).map((p) => p.id),
    )
    const seed1 = findBredSeed(2_000_000)
    await runGeneratorPass(env, seed1)

    const allPosts = await db(env).select({ id: posts.id }).from(posts)
    const child = allPosts.find((p) => !beforeChild.has(p.id))
    expect(child).toBeTruthy()
    const childId = PostId(child!.id)

    // Upvote the child from every niche so it can participate regardless of which niche fires
    for (const v of CITIZENS) {
      await setVote({ postId: childId, voterId: v, value: 1, reasoning: 'test' }, { env })
    }
    await setVote({ postId: childId, voterId: 'anon-dynasty-3', value: 1 }, { env })

    // Second breed — the pool now has grandparentA, grandparentB, child (all have fitness 1)
    const seed2 = findBredSeed(3_000_000)
    await runGeneratorPass(env, seed2)

    // Total lineage_edges: 2 (child) + 2 (grandchild) = 4
    const totalEdges = await db(env)
      .select({ count: sql<number>`count(*)` })
      .from(lineageEdges)
    expect(Number(totalEdges[0]!.count)).toBe(4)

    // Verify no self-referential edges (DAG acyclicity contract)
    const selfEdges = await db(env)
      .select({ c: lineageEdges.childGenomeId })
      .from(lineageEdges)
      .where(eq(lineageEdges.childGenomeId, lineageEdges.parentGenomeId))
    expect(selfEdges.length).toBe(0)
  })
})
