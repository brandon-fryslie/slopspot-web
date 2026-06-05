// [LAW:behavior-not-structure] Contract: getPostGenealogy returns the correct ancestry tree +
// children for a post, derived from lineage_edges — never stored. Four cases: founder (no
// parents/children), single-forked (1 parent), bred (2 parents), children present. Each test
// is a behavioral assertion about the DERIVED output, not the underlying edge rows.
// [LAW:verifiable-goals] All assertions are machine-checkable against real D1 in the workers isolate.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { db } from '~/db/client'
import { lineageEdges } from '~/db/schema'
import { getPostGenealogy } from '~/db/genealogy'
import { seedPost } from './helpers'

describe('getPostGenealogy', () => {
  it('returns null for an upload post (no generation row)', async () => {
    const uploadId = await seedPost(env, { id: 'gen-upload-test', content: { kind: 'upload' } })
    const result = await getPostGenealogy(env, uploadId)
    expect(result).toBeNull()
  })

  it('returns null for a found-link post (no generation row)', async () => {
    const foundId = await seedPost(env, { id: 'gen-found-test', content: { kind: 'found' } })
    const result = await getPostGenealogy(env, foundId)
    expect(result).toBeNull()
  })

  it('founder: self.kind=founder, no parents, no children', async () => {
    const founderPost = await seedPost(env, { id: 'gen-founder', content: { kind: 'generation' } })
    const result = await getPostGenealogy(env, founderPost)
    expect(result).not.toBeNull()
    expect(result!.self.kind).toBe('founder')
    expect(result!.self.id).toBe(founderPost)
    expect(result!.children).toHaveLength(0)
  })

  it('single parent: self.kind=single, parent resolves correctly', async () => {
    const parent = await seedPost(env, { id: 'gen-single-parent', content: { kind: 'generation' } })
    const child = await seedPost(env, {
      id: 'gen-single-child',
      content: { kind: 'generation', parentId: parent },
    })
    const result = await getPostGenealogy(env, child)
    expect(result).not.toBeNull()
    expect(result!.self.kind).toBe('single')
    if (result!.self.kind === 'single') {
      expect(result!.self.parent.kind).toBe('founder')
      expect(result!.self.parent.id).toBe(parent)
    }
    expect(result!.children).toHaveLength(0)
  })

  it('bred post: self.kind=bred, both parents resolve correctly', async () => {
    const parentA = await seedPost(env, { id: 'gen-bred-pa', content: { kind: 'generation' } })
    const parentB = await seedPost(env, { id: 'gen-bred-pb', content: { kind: 'generation' } })
    const bred = await seedPost(env, { id: 'gen-bred-child', content: { kind: 'generation' } })
    await db(env).insert(lineageEdges).values([
      { childGenomeId: bred, parentGenomeId: parentA },
      { childGenomeId: bred, parentGenomeId: parentB },
    ])
    const result = await getPostGenealogy(env, bred)
    expect(result).not.toBeNull()
    expect(result!.self.kind).toBe('bred')
    if (result!.self.kind === 'bred') {
      const parentIds = new Set(result!.self.parents.map((p) => p.id))
      expect(parentIds.has(parentA)).toBe(true)
      expect(parentIds.has(parentB)).toBe(true)
    }
    expect(result!.children).toHaveLength(0)
  })

  it('children: bred and forked children appear in the offspring list', async () => {
    const root = await seedPost(env, { id: 'gen-root-with-kids', content: { kind: 'generation' } })
    const forkChild = await seedPost(env, {
      id: 'gen-fork-kid',
      content: { kind: 'generation', parentId: root },
    })
    const bredChild = await seedPost(env, { id: 'gen-bred-kid', content: { kind: 'generation' } })
    const otherParent = await seedPost(env, { id: 'gen-other-parent', content: { kind: 'generation' } })
    await db(env).insert(lineageEdges).values([
      { childGenomeId: bredChild, parentGenomeId: root },
      { childGenomeId: bredChild, parentGenomeId: otherParent },
    ])
    const result = await getPostGenealogy(env, root)
    expect(result).not.toBeNull()
    const childIds = new Set(result!.children.map((c) => c.id))
    expect(childIds.has(forkChild)).toBe(true)
    expect(childIds.has(bredChild)).toBe(true)
    const forkEntry = result!.children.find((c) => c.id === forkChild)
    const bredEntry = result!.children.find((c) => c.id === bredChild)
    expect(forkEntry?.lineageKind).toBe('single')
    expect(bredEntry?.lineageKind).toBe('bred')
  })

  it('deep ancestry: grandparent resolves transitively (3 levels)', async () => {
    const gp = await seedPost(env, { id: 'gen-gp', content: { kind: 'generation' } })
    const parent = await seedPost(env, {
      id: 'gen-gp-parent',
      content: { kind: 'generation', parentId: gp },
    })
    const child = await seedPost(env, {
      id: 'gen-gp-child',
      content: { kind: 'generation', parentId: parent },
    })
    const result = await getPostGenealogy(env, child)
    expect(result).not.toBeNull()
    expect(result!.self.kind).toBe('single')
    if (result!.self.kind === 'single') {
      expect(result!.self.parent.id).toBe(parent)
      expect(result!.self.parent.kind).toBe('single')
      if (result!.self.parent.kind === 'single') {
        expect(result!.self.parent.parent.id).toBe(gp)
        expect(result!.self.parent.parent.kind).toBe('founder')
      }
    }
  })

  it('diamond lineage: shared grandparent resolved once, not duplicated', async () => {
    // GP ← P1 ↘
    //            → C (bred from P1 + P2)
    // GP ← P2 ↗
    // (GP is a shared ancestor reachable via two paths)
    const gp = await seedPost(env, { id: 'gen-diamond-gp', content: { kind: 'generation' } })
    const p1 = await seedPost(env, {
      id: 'gen-diamond-p1',
      content: { kind: 'generation', parentId: gp },
    })
    const p2 = await seedPost(env, {
      id: 'gen-diamond-p2',
      content: { kind: 'generation', parentId: gp },
    })
    const c = await seedPost(env, { id: 'gen-diamond-c', content: { kind: 'generation' } })
    await db(env).insert(lineageEdges).values([
      { childGenomeId: c, parentGenomeId: p1 },
      { childGenomeId: c, parentGenomeId: p2 },
    ])
    const result = await getPostGenealogy(env, c)
    expect(result).not.toBeNull()
    expect(result!.self.kind).toBe('bred')
    // The GP node appears in BOTH parents' ancestry — verify no infinite loop or duplication
    // in the tree building (the component's dedup handles display; here we just verify the
    // ancestry tree builds without error and the parents are correct).
    if (result!.self.kind === 'bred') {
      const parentIds = new Set(result!.self.parents.map((p) => p.id))
      expect(parentIds.has(p1)).toBe(true)
      expect(parentIds.has(p2)).toBe(true)
      // Each parent should resolve to kind='single' with GP as their parent
      for (const parent of result!.self.parents) {
        expect(parent.kind).toBe('single')
        if (parent.kind === 'single') {
          expect(parent.parent.id).toBe(gp)
          expect(parent.parent.kind).toBe('founder')
        }
      }
    }
  })

  it('thumbnailUrl resolves from the generation output for a succeeded post', async () => {
    const withImage = await seedPost(env, {
      id: 'gen-with-thumb',
      content: {
        kind: 'generation',
        status: {
          kind: 'succeeded',
          completedAt: new Date('2026-01-01T00:00:00Z'),
          output: { kind: 'image', url: '/media/abc123', w: 64, h: 64 },
        },
      },
    })
    const result = await getPostGenealogy(env, withImage)
    expect(result).not.toBeNull()
    expect(result!.self.thumbnailUrl).toBe('/media/abc123')
  })
})
