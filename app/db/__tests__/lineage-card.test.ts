// [LAW:behavior-not-structure] The feed read-model's lineage scalars (slopspot-genome-p6z.3): a
// generation carries its generation DEPTH (longest path to a founder) and its descendant COUNT
// (most-bred), both DERIVED from lineage_edges alone — no stored gen/childCount column. These tests
// seed a real chain (founder → child → grandchild + a sibling) into a real D1 isolate and assert the
// feed reader (getFeedPage AND the permalink getFeedItemById) yields the right numbers, so the
// storage→domain derivation is honest end to end, not a hand-built fixture.
//
// [LAW:one-source-of-truth] The depth/count derivations read ONLY lineage_edges — the same single
// ancestry source the lineage badge and the Cast page's most-bred read.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { getFeedItemById, getFeedPage } from '~/db/feed'
import { PostId } from '~/lib/domain'
import { seedPost } from './helpers'

// founder → child → grandchild is one bloodline (single-parent edges); `sibling` shares the founder,
// so the founder has TWO children and the deepest path under it is length 2.
async function seedChain() {
  const founder = await seedPost(env, { id: 'lc-founder', content: { kind: 'generation' } })
  const child = await seedPost(env, { id: 'lc-child', content: { kind: 'generation', parentId: founder } })
  const grandchild = await seedPost(env, { id: 'lc-gc', content: { kind: 'generation', parentId: child } })
  const sibling = await seedPost(env, { id: 'lc-sibling', content: { kind: 'generation', parentId: founder } })
  return { founder, child, grandchild, sibling }
}

describe('feed read-model - generation depth + descendant count (genome-p6z.3)', () => {
  it('getFeedItemById yields generationDepth = longest path to a founder, and descendantCount = lineage_edges fan-out', async () => {
    const { founder, child, grandchild, sibling } = await seedChain()

    const depthOf = async (id: PostId) => (await getFeedItemById(env, id))?.generationDepth
    const childrenOf = async (id: PostId) => (await getFeedItemById(env, id))?.descendantCount

    // Depth: a founder is gen 0; each hop UP a parent edge adds one; the grandchild's longest path is 2.
    expect(await depthOf(founder)).toBe(0)
    expect(await depthOf(child)).toBe(1)
    expect(await depthOf(grandchild)).toBe(2)
    expect(await depthOf(sibling)).toBe(1)

    // Descendant count: the founder bred TWO (child + sibling); the child bred ONE (grandchild); the
    // leaves bred none. The number is the count of edges pointing AT the post.
    expect(await childrenOf(founder)).toBe(2)
    expect(await childrenOf(child)).toBe(1)
    expect(await childrenOf(grandchild)).toBe(0)
    expect(await childrenOf(sibling)).toBe(0)
  })

  it('getFeedPage carries the same scalars on every FeedItem (the feed view, not just the permalink)', async () => {
    const { founder, grandchild } = await seedChain()
    const items = (await getFeedPage(env, { voterId: undefined, sort: { mode: 'new' } })).items
    const byId = new Map(items.map((i) => [i.post.id, i]))

    // The grandchild is gen 2 with no children; the founder is gen 0 with two — surfaced on the
    // ranked feed item exactly as on the permalink (one read-model, two readers).
    expect(byId.get(grandchild)?.generationDepth).toBe(2)
    expect(byId.get(grandchild)?.descendantCount).toBe(0)
    expect(byId.get(founder)?.generationDepth).toBe(0)
    expect(byId.get(founder)?.descendantCount).toBe(2)
  })
})
