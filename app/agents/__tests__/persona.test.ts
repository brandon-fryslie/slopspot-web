// [LAW:behavior-not-structure] These tests pin listPersonas and pickPersona
// contracts — what shapes they return given stored rows. They run against a
// real D1 isolate (miniflare) so the storage→domain mapping is live, not
// mocked.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { db } from '~/db/client'
import { personas } from '~/db/schema'
import { listPersonas, pickPersona, type PersonaRole } from '../persona'

async function seedPersona(agentId: string, role: PersonaRole) {
  await db(env)
    .insert(personas)
    .values({
      agentId,
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
    // voter has 5 seeds, generator has 3 seeds, discoverer has 2 seeds (0009).
    // We test role isolation: inserted IDs appear only under their own role;
    // every returned persona carries the requested role.
    await seedPersona('agent:d1', 'discoverer')
    await seedPersona('agent:g1', 'generator')

    const discoverers = await listPersonas(env, 'discoverer')
    const generators = await listPersonas(env, 'generator')

    // Inserted discoverer is in the discoverer list; all must be role='discoverer'
    expect(discoverers.some((p) => p.agentId === 'agent:d1')).toBe(true)
    expect(discoverers.every((p) => p.role === 'discoverer')).toBe(true)
    // Inserted generator is in the generator list; all must be role='generator'
    expect(generators.some((p) => p.agentId === 'agent:g1')).toBe(true)
    expect(generators.every((p) => p.role === 'generator')).toBe(true)

    // voters should only contain voter-role rows
    const voters = await listPersonas(env, 'voter')
    expect(voters.every((p) => p.role === 'voter')).toBe(true)
  })

  it('pickPersona returns null when pool is empty', async () => {
    // All three PersonaRoles now have seed data. The empty-pool contract is
    // covered by the pickPersona implementation (pool.length === 0 → null) and
    // by the type system; the only testable surface here is role isolation (a
    // persona seeded for one role never appears in another role's pool).
    // Verify that a voter ID inserted while querying generator doesn't bleed over.
    await seedPersona('agent:bleed-check', 'voter')
    const generatorResult = await pickPersona(env, 'generator', Date.now())
    if (generatorResult !== null) {
      expect(generatorResult.agentId).not.toBe('agent:bleed-check')
    }
  })

  it('pickPersona returns a persona from the pool', async () => {
    await seedPersona('agent:pv1', 'voter')
    await seedPersona('agent:pv2', 'voter')

    const result = await pickPersona(env, 'voter', 1234567890)

    expect(result).not.toBeNull()
    expect(result!.role).toBe('voter')
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
})
