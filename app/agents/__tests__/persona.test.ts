// [LAW:behavior-not-structure] These tests pin listPersonas and pickPersona
// contracts — what shapes they return given stored rows. They run against a
// real D1 isolate (miniflare) so the storage→domain mapping is live, not
// mocked.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { db } from '~/db/client'
import { personas } from '~/db/schema'
import {
  creedOf,
  getPersonaByHandle,
  guildOf,
  listAllPersonas,
  listPersonas,
  pickPersona,
  type PersonaRole,
} from '../persona'

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

  // The seeded generators' medium + full config_json parse contract is locked in
  // generator.test.ts, which runs the real parseGeneratorConfig over these rows —
  // a stronger statement than the typeof-medium check that lived here.
})

describe('the host guild and the Proprietor', () => {
  it('guildOf maps every role to its guild', () => {
    // The total function the Cast roster groups by. Acting roles map to their
    // working guild; the host presides over its own.
    expect(guildOf('generator')).toBe('makers')
    expect(guildOf('voter')).toBe('critics')
    expect(guildOf('discoverer')).toBe('scavengers')
    expect(guildOf('host')).toBe('host')
  })

  it('the Proprietor is seated as a host citizen (migration 0019 round-trip)', async () => {
    // [LAW:behavior-not-structure] A real read against the migration-seeded D1.
    // This fails loud if 0019 never inserted the row, or if the widened
    // personas_role_shape CHECK still rejected role='host' — in which case the
    // migration would not have applied and there'd be no Proprietor to find.
    const p = await getPersonaByHandle(env, 'the-proprietor')

    expect(p).not.toBeNull()
    expect(p!.agentId).toBe('agent:the-proprietor')
    expect(p!.displayName).toBe('The Proprietor')
    expect(p!.role).toBe('host')
    expect(guildOf(p!.role)).toBe('host')
    // His voice round-trips from persona_prompt (the D1-tunable source), and his
    // declined portrait round-trips as data the self-portrait work reads.
    expect(p!.personaPrompt).toMatch(/^You are The Proprietor/)
    expect(p!.config.portrait).toBe('declined')
  })

  it('listAllPersonas places exactly the Proprietor in the host guild', async () => {
    // What the /cast loader does: read the whole roster, bucket by guildOf. The
    // seeded city has one host, and it is the Proprietor.
    const roster = await listAllPersonas(env)
    const host = roster.filter((c) => guildOf(c.role) === 'host')

    expect(host.map((c) => c.handle)).toEqual(['the-proprietor'])
    expect(roster.filter((c) => guildOf(c.role) === 'makers').length).toBeGreaterThan(0)
    expect(roster.filter((c) => guildOf(c.role) === 'critics').length).toBeGreaterThan(0)
  })
})

describe('creedOf — the public creed, never the raw prompt', () => {
  it('extracts the first sentence of the body after the "You are <Name> —" preamble', () => {
    const prompt =
      'You are The Gremlin — the city burier, and you live to bury. Most of it deserves the dark and you send it there.'
    expect(creedOf(prompt)).toBe('the city burier, and you live to bury.')
  })

  it('handles the makers’ "Generator persona — <Name>, ..." preamble', () => {
    const prompt =
      'Generator persona — GutterMonk, an ascetic of the render farm. He works stark and liminal.'
    expect(creedOf(prompt)).toBe('GutterMonk, an ascetic of the render farm.')
  })

  it('never leaks the rest of the bible — the creed is one sentence, not the body', () => {
    const prompt =
      'You are St. Vivian — solemn, generous, devout. You do not laugh at slop; you kneel to it. The one sin you cannot bless is mere competence.'
    const creed = creedOf(prompt)
    expect(creed).toBe('solemn, generous, devout.')
    expect(creed).not.toContain('kneel')
    expect(creed).not.toContain('competence')
  })

  it('falls back to the first sentence when there is no em-dash preamble', () => {
    expect(creedOf('A plain line. A second one.')).toBe('A plain line.')
  })
})
