// [LAW:behavior-not-structure] These tests pin listPersonas and pickPersona
// contracts — what shapes they return given stored rows. They run against a
// real D1 isolate (miniflare) so the storage→domain mapping is live, not
// mocked.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { db } from '~/db/client'
import { personas } from '~/db/schema'
import { getPersonaByHandle, listPersonas, pickPersona, type PersonaRole } from '../persona'

async function seedPersona(agentId: string, role: PersonaRole) {
  await db(env)
    .insert(personas)
    .values({
      agentId,
      // [LAW:one-source-of-truth] handle is unique; derive a stable slug from the
      // agentId so repeated seeds don't collide on the default empty handle.
      handle: agentId.replace('agent:', ''),
      displayName: `Test ${agentId}`,
      role,
      personaPrompt: `Prompt for ${agentId}`,
      modelId: 'glm-4v-flash',
      configJson: JSON.stringify({ upvoteThreshold: 70, downvoteThreshold: 30 }),
      createdAt: new Date(),
    })
}

describe('persona registry', () => {
  it('round-trips a row: insert → listPersonas → match', async () => {
    await seedPersona('agent:test-voter', 'voter')

    const result = await listPersonas(env, 'voter')

    // 5 seed voters + 1 inserted
    const p = result.find((x) => x.agentId === 'agent:test-voter')
    expect(p).toBeDefined()
    expect(p!.agentId).toBe('agent:test-voter')
    expect(p!.displayName).toBe('Test agent:test-voter')
    expect(p!.role).toBe('voter')
    expect(p!.personaPrompt).toBe('Prompt for agent:test-voter')
    expect(p!.modelId).toBe('glm-4v-flash')
    expect(p!.config).toEqual({ upvoteThreshold: 70, downvoteThreshold: 30 })
  })

  it('listPersonas filters by role', async () => {
    // generator has 3 seed rows from 0008, discoverer has 2 from 0009, voter has 5.
    // We test role isolation, not exact count.
    await seedPersona('agent:d1', 'discoverer')
    await seedPersona('agent:g1', 'generator')

    const discoverers = await listPersonas(env, 'discoverer')
    const generators = await listPersonas(env, 'generator')

    expect(discoverers.some((p) => p.agentId === 'agent:d1')).toBe(true)
    expect(discoverers.every((p) => p.role === 'discoverer')).toBe(true)
    expect(generators.some((p) => p.agentId === 'agent:g1')).toBe(true)
    expect(generators.every((p) => p.role === 'generator')).toBe(true)

    const voters = await listPersonas(env, 'voter')
    expect(voters.every((p) => p.role === 'voter')).toBe(true)
  })

  it('listPersonas: seed rows are role-correct for all three roles', async () => {
    // Verify 0007/0008/0009 seeds landed in the right buckets.
    const voters = await listPersonas(env, 'voter')
    const generators = await listPersonas(env, 'generator')
    const discoverers = await listPersonas(env, 'discoverer')

    expect(voters.length).toBeGreaterThan(0)
    expect(generators.length).toBeGreaterThan(0)
    expect(discoverers.length).toBeGreaterThan(0)
    expect(voters.every((p) => p.role === 'voter')).toBe(true)
    expect(generators.every((p) => p.role === 'generator')).toBe(true)
    expect(discoverers.every((p) => p.role === 'discoverer')).toBe(true)
  })

  it('pickPersona does not bleed roles: voter-seeded ID absent from generator pool', async () => {
    await seedPersona('agent:bleed-check-voter', 'voter')

    const result = await pickPersona(env, 'generator', Date.now())

    // result may be null if generator pool is empty, but must never be the voter we just seeded
    expect(result?.agentId).not.toBe('agent:bleed-check-voter')
  })

  it('pickPersona returns a persona from the pool', async () => {
    await seedPersona('agent:pv1', 'discoverer')
    await seedPersona('agent:pv2', 'discoverer')

    const result = await pickPersona(env, 'discoverer', 1234567890)

    expect(result).not.toBeNull()
    expect(result!.role).toBe('discoverer')
  })

  it('pickPersona is deterministic: same time → same persona', async () => {
    await seedPersona('agent:det1', 'voter')
    await seedPersona('agent:det2', 'voter')
    await seedPersona('agent:det3', 'voter')

    const t = 9876543210

    const a = await pickPersona(env, 'voter', t)
    const b = await pickPersona(env, 'voter', t)

    expect(a!.agentId).toBe(b!.agentId)
  })

  it('getPersonaByHandle resolves a citizen by its URL key', async () => {
    await seedPersona('agent:handle-probe', 'voter')

    const p = await getPersonaByHandle(env, 'handle-probe')

    expect(p).not.toBeNull()
    expect(p!.agentId).toBe('agent:handle-probe')
    expect(p!.handle).toBe('handle-probe')
  })

  it('getPersonaByHandle returns null for an unknown handle', async () => {
    expect(await getPersonaByHandle(env, 'no-such-citizen')).toBeNull()
  })

  it('seed generator personas carry a medium provider id in config', async () => {
    // [RECONCILE C] provider is derivable from the author-persona — the 0015
    // migration backfills each starter generator's medium.
    const generators = await listPersonas(env, 'generator')
    expect(generators.length).toBeGreaterThan(0)
    for (const g of generators) {
      expect(typeof g.config.medium).toBe('string')
    }
  })
})
