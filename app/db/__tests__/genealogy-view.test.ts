import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { db } from '~/db/client'
import { lineageEdges } from '~/db/schema'
import { getGenealogy } from '~/db/genealogy-view'
import { PostId, type Media } from '~/lib/domain'
import { seedPost } from './helpers'

// [LAW:behavior-not-structure] The per-post genealogy read's contract over real D1: ancestry walks
// UP the lineage_edges DAG (parents → grandparents, a bred node showing BOTH parent faces), offspring
// walks DOWN (forks/breeds OF the post), each node carries its succeeded phenotype (null when not
// rendered), a founder with no offspring yields two empty arrays, and a lineage edge to a non-genome
// fails loud. Built on the workers isolate, not mocked.

const IMG = (tag: string): Media => ({ kind: 'image', url: `/media/${tag.repeat(64).slice(0, 64)}`, w: 8, h: 8 })

describe('getGenealogy — the per-post lineage slice', () => {
  it('renders ancestry up the chain and offspring down, with phenotypes', async () => {
    // F (founder) ; A forked from F ; D forked from A ; C bred from F + A.
    const F = await seedPost(env, { id: 'gv-F', content: { kind: 'generation', status: { kind: 'succeeded', output: IMG('f'), completedAt: new Date('2026-01-01') } } })
    const A = await seedPost(env, { id: 'gv-A', content: { kind: 'generation', parentId: F, status: { kind: 'succeeded', output: IMG('a'), completedAt: new Date('2026-01-01') } } })
    const D = await seedPost(env, { id: 'gv-D', content: { kind: 'generation', parentId: A, status: { kind: 'succeeded', output: IMG('d'), completedAt: new Date('2026-01-01') } } })
    const C = await seedPost(env, { id: 'gv-C', content: { kind: 'generation', status: { kind: 'succeeded', output: IMG('c'), completedAt: new Date('2026-01-01') } } })
    // Bred edges seeded directly (two parents).
    await db(env).insert(lineageEdges).values([
      { childGenomeId: C, parentGenomeId: F },
      { childGenomeId: C, parentGenomeId: A },
    ])

    // A's ancestry: its one parent F (a founder, no further kin). Its offspring: D and C
    // (both descend from A); D forked, C bred — both appear.
    const a = await getGenealogy(env, A)
    expect(a.ancestors.map((n) => n.postId)).toEqual([PostId('gv-F')])
    expect(a.ancestors[0]!.kin).toEqual([])
    expect(a.ancestors[0]!.thumbnail).toEqual(IMG('f'))
    expect(new Set(a.offspring.map((n) => n.postId))).toEqual(new Set([PostId('gv-D'), PostId('gv-C')]))

    // D's ancestry climbs the chain: parent A, whose own parent is F (grandparent).
    const d = await getGenealogy(env, D)
    expect(d.ancestors.map((n) => n.postId)).toEqual([PostId('gv-A')])
    expect(d.ancestors[0]!.kin.map((n) => n.postId)).toEqual([PostId('gv-F')])
    expect(d.offspring).toEqual([])

    // C is bred — its ancestry shows BOTH parents (ordered by parent id: gv-A before gv-F).
    const c = await getGenealogy(env, C)
    expect(c.ancestors.map((n) => n.postId)).toEqual([PostId('gv-A'), PostId('gv-F')])
    // gv-A expands first, so F surfaces (fully) under A; the second appearance of F (C's other
    // parent) is a leaf tile — every edge shown, no exponential re-expansion.
    expect(c.ancestors[0]!.kin.map((n) => n.postId)).toEqual([PostId('gv-F')])
    expect(c.ancestors[1]!.kin).toEqual([])
    expect(c.offspring).toEqual([])
  })

  it('a founder with no kin yields an empty genealogy', async () => {
    const lone = await seedPost(env, { id: 'gv-lone', content: { kind: 'generation' } })
    expect(await getGenealogy(env, lone)).toEqual({ ancestors: [], offspring: [], siblings: [] })
  })

  it('a node that has not rendered carries a null thumbnail', async () => {
    const parent = await seedPost(env, {
      id: 'gv-pending-parent',
      content: { kind: 'generation', status: { kind: 'running', startedAt: new Date('2026-01-01') } },
    })
    const child = await seedPost(env, { id: 'gv-pending-child', content: { kind: 'generation', parentId: parent } })
    const g = await getGenealogy(env, child)
    expect(g.ancestors.map((n) => n.postId)).toEqual([PostId('gv-pending-parent')])
    expect(g.ancestors[0]!.thumbnail).toBeNull()
  })

  it('resolves same-parent peers as siblings, with their phenotypes, excluding self', async () => {
    // P (founder) with three forks X, Y, Z — pure single-parent siblings. Y has rendered.
    const P = await seedPost(env, { id: 'gv-P', content: { kind: 'generation' } })
    const X = await seedPost(env, { id: 'gv-X', content: { kind: 'generation', parentId: P } })
    await seedPost(env, {
      id: 'gv-Y',
      content: { kind: 'generation', parentId: P, status: { kind: 'succeeded', output: IMG('y'), completedAt: new Date('2026-01-01') } },
    })
    await seedPost(env, {
      id: 'gv-Z',
      content: { kind: 'generation', parentId: P, status: { kind: 'running', startedAt: new Date('2026-01-01') } },
    })

    const x = await getGenealogy(env, X)
    // X's siblings are Y and Z (sorted), never X itself; each is a flat leaf (no nesting).
    expect(x.siblings.map((n) => n.postId)).toEqual([PostId('gv-Y'), PostId('gv-Z')])
    expect(x.siblings.every((n) => n.kin.length === 0)).toBe(true)
    // The rendered sibling carries its thumbnail (read in the same phenotype batch); Z has none.
    expect(x.siblings.find((n) => n.postId === PostId('gv-Y'))!.thumbnail).toEqual(IMG('y'))
    expect(x.siblings.find((n) => n.postId === PostId('gv-Z'))!.thumbnail).toBeNull()
  })

  it('a founder has no siblings (no parent edge, no peers)', async () => {
    const f1 = await seedPost(env, { id: 'gv-founder-1', content: { kind: 'generation' } })
    await seedPost(env, { id: 'gv-founder-2', content: { kind: 'generation' } })
    // Two founders are NOT siblings: they share no parent. The relation is the edge, not co-genesis.
    expect((await getGenealogy(env, f1)).siblings).toEqual([])
  })

  it('counts a full sibling once and a half sibling too (shares AT LEAST one parent, deduped)', async () => {
    // Three founders M, N, O. FULL siblings S1,S2 (both bred from M+N); HALF sibling H (bred M+O).
    const M = await seedPost(env, { id: 'gv-M', content: { kind: 'generation' } })
    const N = await seedPost(env, { id: 'gv-N', content: { kind: 'generation' } })
    const O = await seedPost(env, { id: 'gv-O', content: { kind: 'generation' } })
    const S1 = await seedPost(env, { id: 'gv-S1', content: { kind: 'generation' } })
    const S2 = await seedPost(env, { id: 'gv-S2', content: { kind: 'generation' } })
    const H = await seedPost(env, { id: 'gv-H', content: { kind: 'generation' } })
    await db(env).insert(lineageEdges).values([
      { childGenomeId: S1, parentGenomeId: M },
      { childGenomeId: S1, parentGenomeId: N },
      { childGenomeId: S2, parentGenomeId: M },
      { childGenomeId: S2, parentGenomeId: N },
      { childGenomeId: H, parentGenomeId: M },
      { childGenomeId: H, parentGenomeId: O },
    ])

    // S1 shares BOTH M and N with S2 (collected once, not twice) and M with H → {S2, H}.
    const s1 = await getGenealogy(env, S1)
    expect(s1.siblings.map((n) => n.postId)).toEqual([PostId('gv-H'), PostId('gv-S2')])
  })

  it('fails loud when a lineage edge points at a non-genome (storage corruption)', async () => {
    // An upload has no generations row; an edge to it is a genome-must-be-a-generation violation.
    const u = await seedPost(env, { id: 'gv-upload', content: { kind: 'upload' } })
    const child = await seedPost(env, { id: 'gv-corrupt-child', content: { kind: 'generation', parentId: u } })
    await expect(getGenealogy(env, child)).rejects.toThrow(/has no generations row/)
  })
})
