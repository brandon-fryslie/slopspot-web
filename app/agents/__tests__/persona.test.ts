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
    // discoverer and generator have no seed data, so exact-length checks hold.
    // voter has 5 seed rows; we test role isolation not count.
    await seedPersona('agent:d1', 'discoverer')
    await seedPersona('agent:g1', 'generator')

    const discoverers = await listPersonas(env, 'discoverer')
    const generators = await listPersonas(env, 'generator')

    expect(discoverers.map((p) => p.agentId)).toEqual(['agent:d1'])
    expect(generators.map((p) => p.agentId)).toEqual(['agent:g1'])

    // voters should only contain voter-role rows
    const voters = await listPersonas(env, 'voter')
    expect(voters.every((p) => p.role === 'voter')).toBe(true)
  })

  it('listPersonas returns [] when no personas match the role', async () => {
    // discoverer has no seed data — empty by construction after migrations
    const result = await listPersonas(env, 'discoverer')
    expect(result).toEqual([])
  })

  it('pickPersona returns null when pool is empty', async () => {
    // generator has no seed data — should yield null
    const result = await pickPersona(env, 'generator', Date.now())
    expect(result).toBeNull()
  })

  it('pickPersona returns a persona from the pool', async () => {
    await seedPersona('agent:pv1', 'discoverer')
    await seedPersona('agent:pv2', 'discoverer')

    const result = await pickPersona(env, 'discoverer', 1234567890)

    expect(result).not.toBeNull()
    expect(['agent:pv1', 'agent:pv2']).toContain(result!.agentId)
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
