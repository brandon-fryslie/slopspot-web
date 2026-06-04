// [LAW:behavior-not-structure] The verdict narration CONTRACT (voice-w2v.1): a citizen's recorded vote
// becomes a persisted first-class verdict utterance — spoke when the critic has a take, withheld when
// it does not; a non-citizen (human voter) utters nothing; a re-vote upserts the one current verdict.
// Blind to utter()/recordUtterance decomposition.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { and, eq } from 'drizzle-orm'
import { narrateVerdict } from '~/agents/verdict'
import { db } from '~/db/client'
import { personas, utterances } from '~/db/schema'
import { seedPost } from '../../db/__tests__/helpers'

// Seed a critic persona row (traits_json defaults to neutral). narrateVerdict resolves the speaker
// through getPersona, so a real row must exist for a citizen to have a voice.
async function seedCritic(agentId: string, displayName: string): Promise<void> {
  await db(env).insert(personas).values({
    agentId,
    handle: agentId.replace('agent:', ''),
    displayName,
    role: 'voter',
    personaPrompt: `Prompt for ${agentId}`,
    modelId: 'glm-4v-flash',
    configJson: JSON.stringify({ upvoteThreshold: 70, downvoteThreshold: 30 }),
    createdAt: new Date(),
  })
}

async function rowsFor(speaker: string, postId: string) {
  return db(env)
    .select()
    .from(utterances)
    .where(and(eq(utterances.speaker, speaker), eq(utterances.targetPostId, postId)))
}

describe('narrateVerdict', () => {
  it('records a SPOKE verdict when the critic carries a take (image-grounded reasoning)', async () => {
    await seedCritic('agent:gremlin', 'The Gremlin')
    const id = await seedPost(env, { id: 'nv-spoke' })
    await narrateVerdict(env, { speaker: 'agent:gremlin', postId: id, vote: -1, reasoning: 'Mid. Buried.' })

    const rows = await rowsFor('agent:gremlin', id)
    expect(rows).toHaveLength(1)
    expect(rows[0].occasion).toBe('verdict')
    expect(rows[0].kind).toBe('spoke')
    expect(rows[0].text).toBe('Mid. Buried.')
    expect(rows[0].withheldReason).toBeNull()
  })

  it('records a WITHHELD verdict (indifferent) when the critic has no take', async () => {
    await seedCritic('agent:vivian', 'St. Vivian')
    const id = await seedPost(env, { id: 'nv-withheld' })
    // an agent vote with no reasoning — a take not worth voicing
    await narrateVerdict(env, { speaker: 'agent:vivian', postId: id, vote: 1 })

    const rows = await rowsFor('agent:vivian', id)
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('withheld')
    expect(rows[0].withheldReason).toBe('indifferent')
    expect(rows[0].text).toBeNull()
  })

  it('utters NOTHING for a non-citizen (a human voter has no persona row)', async () => {
    const id = await seedPost(env, { id: 'nv-human' })
    await narrateVerdict(env, { speaker: 'anon-cookie-uuid', postId: id, vote: 1, reasoning: 'i like it' })

    const rows = await rowsFor('anon-cookie-uuid', id)
    expect(rows).toEqual([])
  })

  it('a re-vote UPSERTS the one current verdict (not a second row)', async () => {
    await seedCritic('agent:gremlin', 'The Gremlin')
    const id = await seedPost(env, { id: 'nv-revote' })
    await narrateVerdict(env, { speaker: 'agent:gremlin', postId: id, vote: -1, reasoning: 'Buried.' })
    // the critic reconsiders — the latest take replaces, never accumulates a second verdict row
    await narrateVerdict(env, { speaker: 'agent:gremlin', postId: id, vote: 1, reasoning: 'Fine. Up. Once.' })

    const rows = await rowsFor('agent:gremlin', id)
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe('Fine. Up. Once.')
  })
})
