// [LAW:behavior-not-structure] Pins the First-Poet Rite (slopspot-beyond-image-poj.4) end-to-end against a
// real D1 isolate. The load-bearing facts: the first verse-citizen is decreed the city's first poet EXACTLY
// once; a second verse-citizen does NOT re-decree; the EARLIEST verse-citizen by created_at is the one
// honored; the decree is DERIVED FROM STATE, so it fires even for a poet that predates the ceremony (the
// race test) and never for an all-image city. The no-seed invariant (gate c) is asserted against the live
// migration-seeded city — no seeded citizen produces verse, so a fresh city has no first poet.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { db } from '~/db/client'
import { honors, personas } from '~/db/schema'
import { earliestVerseCitizen } from '~/agents/persona'
import { FIRST_POET_KIND, maybeDecreeFirstPoet } from '~/agents/firstPoet'
import { honorOf } from '~/db/honors'

// A generator citizen with a chosen medium (a real provider id) and birth time. medium 'verse' produces
// text (a poet); 'fal-flux' produces an image — the same provider registry the rite derives verse-ness from.
async function seedGenerator(agentId: string, medium: 'verse' | 'fal-flux', createdAt: Date) {
  await db(env)
    .insert(personas)
    .values({
      agentId,
      handle: agentId.replace('agent:', ''),
      displayName: `Poet ${agentId}`,
      role: 'generator',
      personaPrompt: `You are ${agentId} — a maker of things. It works in its own way.`,
      modelId: 'glm-4v-flash',
      configJson: JSON.stringify({ medium, creed: `${agentId} creed`, promptPrefix: 'in its voice' }),
      createdAt,
    })
}

const DAY = 24 * 60 * 60 * 1000

describe('the no-seed invariant (gate c) — the city ships with no first poet', () => {
  it('no migration-seeded citizen produces verse, so a fresh city has no verse-citizen', async () => {
    // [LAW:one-source-of-truth] Asserted against the LIVE migration-seeded rows (the same source the
    // firehose reads), not a text grep — a seeded verse persona would surface here as a non-null poet.
    expect(await earliestVerseCitizen(env)).toBeNull()
  })

  it('an all-image city is decreed no poet — the honest no-poet state', async () => {
    await seedGenerator('agent:painter', 'fal-flux', new Date(1_000_000))

    const result = await maybeDecreeFirstPoet(env)

    expect(result).toEqual({ kind: 'no-poet' })
    expect(await honorOf(env, FIRST_POET_KIND)).toBeNull()
  })
})

describe('maybeDecreeFirstPoet — the first verse-citizen is decreed once, ever', () => {
  it('decrees the first verse-citizen, names it, and records exactly one honor', async () => {
    await seedGenerator('agent:first-voice', 'verse', new Date(2_000_000))

    const result = await maybeDecreeFirstPoet(env)

    expect(result.kind).toBe('decreed')
    expect(result.kind === 'decreed' && result.agentId).toBe('agent:first-voice')
    expect(result.kind === 'decreed' && result.decree.kind).toBe('spoke')

    const honor = await honorOf(env, FIRST_POET_KIND)
    expect(honor?.agentId).toBe('agent:first-voice')
    expect(await db(env).select().from(honors)).toHaveLength(1)
  })

  it('a re-fire records nothing new — fires once ever (idempotent on the honor record)', async () => {
    await seedGenerator('agent:first-voice', 'verse', new Date(2_000_000))

    await maybeDecreeFirstPoet(env)
    const again = await maybeDecreeFirstPoet(env)

    expect(again).toEqual({ kind: 'already-decreed', agentId: 'agent:first-voice' })
    expect(await db(env).select().from(honors)).toHaveLength(1)
  })

  it('a SECOND verse-citizen does NOT re-decree — the honor still names the first', async () => {
    await seedGenerator('agent:elder-poet', 'verse', new Date(2_000_000))
    await maybeDecreeFirstPoet(env)

    // A new verse-citizen joins later — the city already has its first poet.
    await seedGenerator('agent:younger-poet', 'verse', new Date(5_000_000))
    const after = await maybeDecreeFirstPoet(env)

    expect(after).toEqual({ kind: 'already-decreed', agentId: 'agent:elder-poet' })
    expect(await db(env).select().from(honors)).toHaveLength(1)
  })

  it('decrees the EARLIEST verse-citizen by created_at, not a later one', async () => {
    // Born order: image (oldest), verse-mid, verse-late. The earliest VERSE citizen is verse-mid — an
    // older IMAGE citizen does not steal the title, and a later verse citizen does not.
    await seedGenerator('agent:old-painter', 'fal-flux', new Date(1_000_000))
    await seedGenerator('agent:verse-mid', 'verse', new Date(3_000_000))
    await seedGenerator('agent:verse-late', 'verse', new Date(9_000_000))

    const result = await maybeDecreeFirstPoet(env)

    expect(result.kind === 'decreed' && result.agentId).toBe('agent:verse-mid')
  })

  it('RACE: decrees a verse-citizen that PREDATES the ceremony — derived from state, not a birth event', async () => {
    // The poet was "born" long before this rite ever ran (no birth-event path touched it); a later image
    // citizen joined after. The rite reads STATE — a verse-citizen exists and none was honored — and reaches
    // back to decree the earliest one regardless. This is the whole point of deriving from state: a poet born
    // before the ceremony existed is still caught.
    const longAgo = new Date(Date.now() - 400 * DAY)
    await seedGenerator('agent:ancient-poet', 'verse', longAgo)
    await seedGenerator('agent:newer-painter', 'fal-flux', new Date(Date.now() - 1 * DAY))

    const result = await maybeDecreeFirstPoet(env)

    expect(result.kind).toBe('decreed')
    expect(result.kind === 'decreed' && result.agentId).toBe('agent:ancient-poet')
    // The decree names the poet and pronounces the honor.
    expect(result.kind === 'decreed' && result.decree.kind === 'spoke' && result.decree.text).toContain('first poet')
  })
})
