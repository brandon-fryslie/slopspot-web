// [LAW:behavior-not-structure] Pins the seatCitizen seam against a real D1
// isolate (miniflare): the empty-pool terminal state, role isolation, and RNG
// injection — the storage→selection path the pure selectSeat tests cannot reach.
// The pure weighting contract lives in app/agents/seating.test.ts (node).

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { db } from '~/db/client'
import { personas } from '~/db/schema'
import { seatCitizen, type Wish } from '../seating'
import type { PersonaRole } from '../persona'

const WISH: Wish = { text: 'make me a dragon' }

async function seedPersona(agentId: string, role: PersonaRole) {
  await db(env)
    .insert(personas)
    .values({
      agentId,
      handle: agentId.replace('agent:', ''),
      displayName: `Test ${agentId}`,
      role,
      personaPrompt: `Prompt for ${agentId}`,
      modelId: 'claude-haiku-4-5',
      configJson: '{}',
      createdAt: new Date(),
    })
}

async function clearRole(role: PersonaRole) {
  await db(env).delete(personas).where(eq(personas.role, role))
}

describe('seatCitizen - the wish-answerer seam', () => {
  it('returns null when no generator citizen is active', async () => {
    await clearRole('generator')
    expect(await seatCitizen(env, WISH)).toBeNull()
  })

  it('never seats a non-generator citizen', async () => {
    await clearRole('generator')
    await seedPersona('agent:gen-only', 'generator')
    await seedPersona('agent:a-voter', 'voter')
    for (let i = 0; i < 50; i++) {
      const seated = await seatCitizen(env, WISH, { rng: () => i / 50 })
      expect(seated?.role).toBe('generator')
      expect(seated?.agentId).not.toBe('agent:a-voter')
    }
  })

  it('honors the injected RNG deterministically', async () => {
    await clearRole('generator')
    // listPersonas orders by agent_id asc -> [g-a, g-b, g-c]; uniform v1 weights
    // -> equal thirds [0,1/3) [1/3,2/3) [2/3,1).
    await seedPersona('agent:g-a', 'generator')
    await seedPersona('agent:g-b', 'generator')
    await seedPersona('agent:g-c', 'generator')
    expect((await seatCitizen(env, WISH, { rng: () => 0.0 }))?.agentId).toBe('agent:g-a')
    expect((await seatCitizen(env, WISH, { rng: () => 0.5 }))?.agentId).toBe('agent:g-b')
    expect((await seatCitizen(env, WISH, { rng: () => 0.99 }))?.agentId).toBe('agent:g-c')
  })
})
