// slopspot-genome-brs (The Noticing, Piece 1) — the firing GATE, driven against the REAL
// maybeNotice → utter('noticing') → recordUtterance → getChorus path against a D1 isolate.
//
// The contract under test:
//   • pressure 1 (a saturated pool) → a critic records a noticing about the over-represented family,
//     keyed to a representative slop, and it surfaces on the masthead chorus.
//   • pressure 0 (a varied pool) → the city stays QUIET; the rate IS the pressure, so nothing is recorded.
//   • a real convergence with NO critic seeded → an observable no-op (no row), never a thrown fire.
//   • DOCTRINE: the recorded line NOTICES the family, it never DECLARES an era for it (doctrine/on-eras.md).
//
// maybeNotice takes (recent, pressure) directly — the firing gate is verifiable without driving the whole
// reproduction/createPost/provider path, the same way revealGrace is exercised apart from the rarity fold.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { maybeNotice } from '~/agents/generator'
import { getChorus } from '~/db/chorus'
import { db } from '~/db/client'
import type { RecentRecipe } from '~/db/recent'
import { PostId, ProviderId } from '~/lib/domain'
import { seedPost } from '../../db/__tests__/helpers'

const T = 1_900_000_000_000

// The isolate's migrations pre-seed the real voter roster, so pickPersona('voter') always resolves to SOME
// critic. To make the speaker deterministic (and to exercise the empty-pool no-op honestly), each test first
// clears the voter pool, then seeds exactly the critics it wants. (isolatedStorage rolls this back per-test.)
async function clearVoters(): Promise<void> {
  await env.DB.prepare(`DELETE FROM personas WHERE role = 'voter'`).run()
}

// A critic persona — pickPersona('voter') resolves it; the chorus requires a non-blank display name.
async function seedCritic(agentId: string, displayName: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO personas (agent_id, handle, display_name, role, persona_prompt, model_id, config_json, created_at)
     VALUES (?, NULL, ?, 'voter', 'p', 'm', '{}', 0)`,
  )
    .bind(agentId, displayName)
    .run()
}

// Sole critic → a deterministic speaker. Clears the seeded roster, then seeds one.
async function seedOnlyCritic(agentId: string, displayName: string): Promise<void> {
  await clearVoters()
  await seedCritic(agentId, displayName)
}

// A converged window of `family` foxes whose newest member (recent[0]) is `representative` — the shape
// dominantFamily reads. Only the fields the reading touches matter; the rest are filler.
function converged(family: string, representative: string, n: number): RecentRecipe[] {
  return Array.from({ length: n }, (_, i) => ({
    postId: i === 0 ? PostId(representative) : PostId(`other-${i}`),
    providerId: ProviderId('fal-flux'),
    styleFamily: 'photoreal' as const,
    subjectTemplate: 'T01' as const,
    slots: { animal: family },
    aspectRatio: '1:1' as const,
  }))
}

async function noticingRows(): Promise<
  Array<{ speaker: string; target_post_id: string | null; kind: string; text: string | null }>
> {
  const rows = await env.DB.prepare(
    `SELECT speaker, target_post_id, kind, text FROM utterances WHERE occasion = 'noticing'`,
  ).all<{ speaker: string; target_post_id: string | null; kind: string; text: string | null }>()
  return rows.results
}

describe('The Noticing — the firing gate (slopspot-genome-brs)', () => {
  it('pressure 1: a critic records a noticing about the family, keyed to a representative slop', async () => {
    await seedOnlyCritic('agent:idris', 'Idris')
    await seedPost(env, { id: 'rep-fox' })

    await maybeNotice(env, converged('fox', 'rep-fox', 20), 1, T)

    const rows = await noticingRows()
    expect(rows.length).toBe(1)
    expect(rows[0].speaker).toBe('agent:idris')
    expect(rows[0].target_post_id).toBe('rep-fox')
    expect(rows[0].kind).toBe('spoke')
    expect((rows[0].text ?? '').toLowerCase()).toContain('fox')
  })

  it('NOTICES, never DECLARES — the recorded line carries no era proclamation', async () => {
    await seedOnlyCritic('agent:idris', 'Idris')
    await seedPost(env, { id: 'rep-fox' })

    await maybeNotice(env, converged('fox', 'rep-fox', 20), 1, T)

    const line = ((await noticingRows())[0]?.text ?? '').toLowerCase()
    expect(line.length).toBeGreaterThan(0)
    expect(line).not.toMatch(/year of the\b/)
    expect(line).not.toMatch(/\bera\b|\bage of\b|\bepoch\b/)
  })

  it('pressure 0: the city stays quiet — the rate is the pressure, nothing is recorded', async () => {
    await seedOnlyCritic('agent:idris', 'Idris')
    await seedPost(env, { id: 'rep-fox' })

    await maybeNotice(env, converged('fox', 'rep-fox', 20), 0, T)

    expect((await noticingRows()).length).toBe(0)
  })

  it('a real convergence with no critic seeded is an observable no-op, never a thrown fire', async () => {
    await clearVoters()
    await seedPost(env, { id: 'rep-fox' })

    // No voter persona exists → pickPersona('voter') is null. The mechanism ran; there is simply no one to
    // speak. It must not throw and must record nothing.
    await expect(maybeNotice(env, converged('fox', 'rep-fox', 20), 1, T)).resolves.toBeUndefined()
    expect((await noticingRows()).length).toBe(0)
  })

  it('the recorded noticing surfaces on the masthead chorus', async () => {
    await seedOnlyCritic('agent:idris', 'Idris')
    await seedPost(env, { id: 'rep-fox' })

    await maybeNotice(env, converged('fox', 'rep-fox', 20), 1, T)

    const chorus = await getChorus(db(env))
    expect(chorus.length).toBe(1)
    expect(chorus[0].speaker).toBe('agent:idris')
    expect(chorus[0].postId).toBe('rep-fox')
    expect(chorus[0].text.toLowerCase()).toContain('fox')
  })
})
