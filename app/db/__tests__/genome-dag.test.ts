import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { db } from '~/db/client'
import { lineageEdges } from '~/db/schema'
import { getLineageDag } from '~/db/genome-dag'
import { GenomeId } from '~/lib/domain'
import { seedPost } from './helpers'

// [LAW:behavior-not-structure] The whole-DAG read's contract: every genome reconstructed (genes +
// traits), the child→parent and parent→child adjacency built from lineage_edges, and each node's
// lineage folded from its edge count — founder (0), single (1), bred (2). Built on real D1 in the
// workers isolate, not mocked.

describe('getLineageDag — the whole lineage DAG snapshot', () => {
  it('reconstructs nodes + adjacency + lineage for a founder / single / bred DAG', async () => {
    // F (founder) ; A forked from F (single) ; C bred from F + A (two edges).
    const F = await seedPost(env, { id: 'dag-F', content: { kind: 'generation', styleFamily: 'oil-painting' } })
    const A = await seedPost(env, {
      id: 'dag-A',
      content: { kind: 'generation', styleFamily: 'anime', parentId: F },
    })
    const C = await seedPost(env, { id: 'dag-C', content: { kind: 'generation', styleFamily: 'watercolor' } })
    // Bred edges seeded directly (two parents) — ordered by parent id on read.
    await db(env).insert(lineageEdges).values([
      { childGenomeId: C, parentGenomeId: F },
      { childGenomeId: C, parentGenomeId: A },
    ])

    const dag = await getLineageDag(env)

    // Nodes: genes reconstructed from columns.
    expect(dag.nodes.get(GenomeId('dag-F'))!.genes.species).toBe('oil-painting')
    expect(dag.nodes.get(GenomeId('dag-A'))!.genes.species).toBe('anime')
    expect(dag.nodes.get(GenomeId('dag-C'))!.genes.species).toBe('watercolor')

    // Parents (child → parent ids).
    expect(dag.parents.get(GenomeId('dag-A'))).toEqual([GenomeId('dag-F')])
    expect(dag.parents.get(GenomeId('dag-C'))).toEqual([GenomeId('dag-A'), GenomeId('dag-F')]) // ordered by parent id
    expect(dag.parents.get(GenomeId('dag-F'))).toBeUndefined() // founder: no parents

    // Children (parent → child ids).
    expect(new Set(dag.children.get(GenomeId('dag-F')))).toEqual(new Set([GenomeId('dag-A'), GenomeId('dag-C')]))
    expect(dag.children.get(GenomeId('dag-A'))).toEqual([GenomeId('dag-C')])

    // Lineage folded from edge count.
    expect(dag.nodes.get(GenomeId('dag-F'))!.lineage).toEqual({ kind: 'founder' })
    expect(dag.nodes.get(GenomeId('dag-A'))!.lineage).toEqual({ kind: 'single', parent: GenomeId('dag-F') })
    expect(dag.nodes.get(GenomeId('dag-C'))!.lineage).toEqual({
      kind: 'bred',
      parents: [GenomeId('dag-A'), GenomeId('dag-F')],
    })
  })

  it('returns empty maps on an empty DB (the bootstrap is the data)', async () => {
    const dag = await getLineageDag(env)
    expect(dag.nodes.size).toBe(0)
    expect(dag.parents.size).toBe(0)
    expect(dag.children.size).toBe(0)
  })
})
