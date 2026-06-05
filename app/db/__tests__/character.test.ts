// [LAW:behavior-not-structure] The accreted-character DERIVATION contract (slopspot-voice-w2v.3): a
// citizen's effective voice traits are read from its REAL act history against D1 — the generation slops
// it voted on, joined to their genome vectors — and tinted by recency. Runs against real D1 (the join is
// real SQL), proving the character is derivable from the acts the way feudStanding is. Blind to the
// query shape; pinned on the effective vector and the register it produces.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { characterActs, effectiveTraits } from '~/db/character'
import { db } from '~/db/client'
import { traitBias } from '~/lib/register'
import { NEUTRAL_TRAITS } from '~/lib/traits'
import type { TraitVector } from '~/lib/domain'
import { seedPost, seedVote } from './helpers'

const NOW = new Date('2026-06-04T00:00:00Z')
const recently = (k: number) => new Date(NOW.getTime() - k * 60 * 60 * 1000) // k hours before now
const EARNEST: TraitVector = { austerity: 0.5, curse: 0.5, density: 0.5, earnestness: 1 }

describe('effectiveTraits — derived from the citizen\'s acts', () => {
  it('a citizen with NO history speaks in its base register (effective === base)', async () => {
    const effective = await effectiveTraits(db(env), 'agent:blank', NEUTRAL_TRAITS, NOW)
    expect(effective).toEqual(NEUTRAL_TRAITS)
  })

  it('a run of BURIES on earnest slops drops effective earnestness below base AND changes the register', async () => {
    const citizen = 'agent:gremlin-past'
    for (let k = 0; k < 5; k++) {
      const slop = await seedPost(env, {
        id: `char-bury-${k}`,
        content: { kind: 'generation', traits: EARNEST },
      })
      await seedVote(env, { postId: slop, voterId: citizen, value: -1, createdAt: recently(k) })
    }

    const effective = await effectiveTraits(db(env), citizen, NEUTRAL_TRAITS, NOW)

    // Burying earnest slops pushes the citizen toward the ironic pole — measurably below the neutral base.
    expect(effective.earnestness).toBeLessThan(NEUTRAL_TRAITS.earnestness)
    // The register MEASURABLY shifts: a neutral base renders no steer; the accreted vector renders one.
    expect(traitBias(effective)).not.toBe(traitBias(NEUTRAL_TRAITS))
    expect(traitBias(NEUTRAL_TRAITS)).toBe('')
    expect(traitBias(effective)).not.toBe('')
  })

  it('found/upload slops are NOT acts — they carry no genome vector, so they never tint the character', async () => {
    const citizen = 'agent:scavenger-past'
    const found = await seedPost(env, { id: 'char-found', content: { kind: 'found' } })
    const upload = await seedPost(env, { id: 'char-upload', content: { kind: 'upload' } })
    await seedVote(env, { postId: found, voterId: citizen, value: -1, createdAt: recently(0) })
    await seedVote(env, { postId: upload, voterId: citizen, value: 1, createdAt: recently(0) })

    expect(await characterActs(db(env), citizen)).toEqual([])
    expect(await effectiveTraits(db(env), citizen, NEUTRAL_TRAITS, NOW)).toEqual(NEUTRAL_TRAITS)
  })

  it('characterActs reads exactly the citizen\'s GENERATION votes, with each slop\'s genome vector', async () => {
    const citizen = 'agent:reader-past'
    const slop = await seedPost(env, { id: 'char-act-gen', content: { kind: 'generation', traits: EARNEST } })
    const other = await seedPost(env, { id: 'char-act-other', content: { kind: 'generation', traits: EARNEST } })
    await seedVote(env, { postId: slop, voterId: citizen, value: 1, createdAt: recently(2) })
    await seedVote(env, { postId: other, voterId: 'agent:someone-else', value: 1, createdAt: recently(2) })

    const acts = await characterActs(db(env), citizen)
    expect(acts).toHaveLength(1)
    expect(acts[0]).toMatchObject({ traits: EARNEST, value: 1, createdAt: recently(2) })
  })
})
