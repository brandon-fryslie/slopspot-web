// [LAW:behavior-not-structure] The whole-dynasty fold (slopspot-genome-p6z.2): getDynasty roots at a
// post's FOUNDER(S) and yields each founding line's whole descendant tree, derived from lineage_edges
// alone. These seed a real multi-generation breeding DAG into a real D1 isolate and assert the founder
// forest's structure (node set + generation assignment + bred-diamond dedup + multi-founder forest),
// not a hand-built fixture.
//
// [LAW:one-source-of-truth] The fold reads ONLY lineage_edges (via getDynasty's edge read) — the same
// single ancestry source the per-post tree and the card's depth use.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { getDynasty } from '~/db/genealogy-view'
import { db } from '~/db/client'
import { lineageEdges } from '~/db/schema'
import { PostId, type GenealogyNode } from '~/lib/domain'
import { seedPost } from './helpers'

// A second parent edge (the helper's parentId seeds ONE; a bred node needs two).
async function breedEdge(child: PostId, parent: PostId) {
  await db(env).insert(lineageEdges).values({ childGenomeId: child, parentGenomeId: parent })
}

// Every postId in a founder-rooted tree (the founder + its whole subtree), deduped.
function nodeIdsOf(roots: readonly GenealogyNode[]): Set<string> {
  const out = new Set<string>()
  const walk = (n: GenealogyNode) => {
    out.add(n.postId)
    n.kin.forEach(walk)
  }
  roots.forEach(walk)
  return out
}

// Occurrence count across the WHOLE forest — NOT a Set. A Set collapses a re-rendered diamond node,
// masking a dropped dedup; counting catches it. A re-encountered node renders ONCE expanded, then leaf.
function occurrencesOf(roots: readonly GenealogyNode[]): Map<string, number> {
  const m = new Map<string, number>()
  const walk = (n: GenealogyNode) => {
    m.set(n.postId, (m.get(n.postId) ?? 0) + 1)
    n.kin.forEach(walk)
  }
  roots.forEach(walk)
  return m
}

const G = (id: string) => `dyn-${id}`

describe('getDynasty - founder-rooted whole-bloodline forest (genome-p6z.2)', () => {
  it('roots a bred post at its single founder and renders the whole tree, diamond deduped', async () => {
    // F → A, F → B (F has two children), C bred from A + B (a diamond under F).
    const f = await seedPost(env, { id: G('f'), content: { kind: 'generation' } })
    const a = await seedPost(env, { id: G('a'), content: { kind: 'generation', parentId: f } })
    const b = await seedPost(env, { id: G('b'), content: { kind: 'generation', parentId: f } })
    const c = await seedPost(env, { id: G('c'), content: { kind: 'generation', parentId: a } })
    await breedEdge(c, b) // C's second parent — A and B both trace to F, so C has ONE founder

    const dynasty = await getDynasty(env, c)

    // ONE founder (F): A and B both descend from F, so C belongs to exactly one bloodline.
    expect(dynasty.founders.map((n) => n.postId)).toEqual([f])
    // The founder's whole tree contains F + A + B + C — the diamond child C appears (deduped to one
    // canonical node, then a leaf on the second path; the node SET has it once).
    expect(nodeIdsOf(dynasty.founders)).toEqual(new Set([f, a, b, c]))
    // Generation assignment by tree depth: F is the root; A and B are its kin (gen 1); C is under A
    // (gen 2) — the longest path founder→C is 2, matching the depth lock.
    const founder = dynasty.founders[0]!
    expect(founder.postId).toBe(f)
    expect(new Set(founder.kin.map((n) => n.postId))).toEqual(new Set([a, b]))
    const aNode = founder.kin.find((n) => n.postId === a)!
    expect(aNode.kin.map((n) => n.postId)).toEqual([c])
  })

  it('renders the FOREST of ALL ancestral founders for a post bred across two bloodlines', async () => {
    // Bloodline 1: F1 → X. Bloodline 2: F2 → Y. Z bred from X + Y → Z descends from F1 AND F2.
    const f1 = await seedPost(env, { id: G('f1'), content: { kind: 'generation' } })
    const x = await seedPost(env, { id: G('x'), content: { kind: 'generation', parentId: f1 } })
    const f2 = await seedPost(env, { id: G('f2'), content: { kind: 'generation' } })
    const y = await seedPost(env, { id: G('y'), content: { kind: 'generation', parentId: f2 } })
    const z = await seedPost(env, { id: G('z'), content: { kind: 'generation', parentId: x } })
    await breedEdge(z, y)

    const dynasty = await getDynasty(env, z)

    // TWO founders — the honest forest: Z belongs to both F1's and F2's bloodlines, neither dropped.
    expect(new Set(dynasty.founders.map((n) => n.postId))).toEqual(new Set([f1, f2]))
    // Each founding line's whole tree is present (F1→X→Z and F2→Y→Z); Z is in both lines.
    expect(nodeIdsOf(dynasty.founders)).toEqual(new Set([f1, x, f2, y, z]))
  })

  it('a DEEP diamond expands the shared subtree ONCE, never twice (buildTree dedup is load-bearing)', async () => {
    // F -> A, F -> B; A -> D, B -> D (D is a bred diamond); D -> E. The grandchild E hangs BELOW the
    // diamond, so dedup vs no-dedup differ in OUTPUT shape: with dedup, D expands once (E rendered
    // once) and is a leaf on the second path; WITHOUT dedup, D expands under both A and B and E
    // renders TWICE (and a deeper DAG blows up exponentially). A Set can't see that — only a count.
    const f = await seedPost(env, { id: G('df'), content: { kind: 'generation' } })
    const a = await seedPost(env, { id: G('da'), content: { kind: 'generation', parentId: f } })
    const b = await seedPost(env, { id: G('db2'), content: { kind: 'generation', parentId: f } })
    const d = await seedPost(env, { id: G('dd'), content: { kind: 'generation', parentId: a } })
    await breedEdge(d, b) // D bred from A + B (the diamond)
    const e = await seedPost(env, { id: G('de'), content: { kind: 'generation', parentId: d } })

    const dynasty = await getDynasty(env, e)
    const occ = occurrencesOf(dynasty.founders)

    // THE TEETH: E hangs below the shared node D and must appear EXACTLY ONCE — the expanded-set stops
    // the second path (B→D) from re-expanding D's subtree. Without buildTree's dedup this is 2 (the
    // regression a Set-based assertion can't see). Proven: neutering the dedup reds this `2 to be 1`.
    expect(occ.get(e)).toBe(1)
    // The OTHER direction of the contract: D itself is shown on BOTH paths (every edge rendered, no
    // OVER-prune) but expanded only once — one occurrence carries its child E, the other is a leaf.
    expect(occ.get(d)).toBe(2)
    // The whole bloodline's node SET is still complete.
    expect(nodeIdsOf(dynasty.founders)).toEqual(new Set([f, a, b, d, e]))
  })

  it('a lone founder is its own one-node dynasty (no descendants -> a single rooted tile)', async () => {
    const lone = await seedPost(env, { id: G('lone'), content: { kind: 'generation' } })
    const dynasty = await getDynasty(env, lone)
    expect(dynasty.founders.map((n) => n.postId)).toEqual([lone])
    expect(dynasty.founders[0]!.kin).toEqual([])
  })
})
