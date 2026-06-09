import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { getBreedablePool } from '~/db/feed'
import { PostId } from '~/lib/domain'
import { seedPost } from './helpers'

// [LAW:behavior-not-structure] The breeding room's mate pool contract: every SUCCEEDED generation is
// a breedable candidate (parent A excluded), the order is a DETERMINISTIC function of the seed, a
// fresh seed reshuffles the SAME pool to a different slice, and the result is windowed. This is the
// un-fusing from the homepage Hot feed — a genome off Hot page 1 must still be reachable as a mate.

const ids = (pool: Awaited<ReturnType<typeof getBreedablePool>>) => pool.map((p) => p.post.id)

describe('getBreedablePool — the human breeder\'s mate candidate set', () => {
  it('returns succeeded generations, excludes parent A and every non-breedable post', async () => {
    const parent = await seedPost(env, { id: 'bp-parent', content: { kind: 'generation' } })
    const mate = await seedPost(env, { id: 'bp-mate', content: { kind: 'generation' } })
    await seedPost(env, {
      id: 'bp-failed',
      content: { kind: 'generation', status: { kind: 'failed', reason: 'boom', failedAt: new Date('2026-01-01') } },
    })
    await seedPost(env, { id: 'bp-found', content: { kind: 'found' } })
    await seedPost(env, { id: 'bp-upload', content: { kind: 'upload' } })

    const pool = await getBreedablePool(env, { excludeId: parent, seed: 'seed-a' })

    // Only the one succeeded sibling generation is a mate; parent, failed, found, upload all excluded.
    expect(ids(pool)).toEqual([mate])
  })

  it('is deterministic: the same seed yields the same order every read', async () => {
    for (let i = 0; i < 8; i++) await seedPost(env, { id: `det-${i}`, content: { kind: 'generation' } })
    const parent = PostId('det-0')

    const first = ids(await getBreedablePool(env, { excludeId: parent, seed: 'fixed' }))
    const second = ids(await getBreedablePool(env, { excludeId: parent, seed: 'fixed' }))

    expect(second).toEqual(first)
  })

  it('reshuffles on a new seed: a different seed reorders the SAME pool (whole pool reachable across seeds)', async () => {
    for (let i = 0; i < 12; i++) await seedPost(env, { id: `rs-${i}`, content: { kind: 'generation' } })
    const parent = PostId('rs-0')

    const a = ids(await getBreedablePool(env, { excludeId: parent, seed: 'seed-a' }))
    const b = ids(await getBreedablePool(env, { excludeId: parent, seed: 'seed-b' }))

    // Same membership (the whole pool fits one window here), different order — the reshuffle is real.
    expect([...a].sort()).toEqual([...b].sort())
    expect(a).not.toEqual(b)
  })

  it('windows the pool: a pool larger than the window returns exactly `window` mates', async () => {
    for (let i = 0; i < 30; i++) await seedPost(env, { id: `win-${String(i).padStart(2, '0')}`, content: { kind: 'generation' } })
    const parent = PostId('win-00')

    const pool = await getBreedablePool(env, { excludeId: parent, seed: 'w', window: 10 })
    expect(pool).toHaveLength(10)
  })

  it('returns [] when no breedable mate exists (the empty pool flows through, no throw)', async () => {
    const parent = await seedPost(env, { id: 'lonely', content: { kind: 'generation' } })
    expect(await getBreedablePool(env, { excludeId: parent, seed: 'x' })).toEqual([])
  })
})
