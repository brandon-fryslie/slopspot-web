// slopspot-patronage-ts7.9 (The Third-Person Reveal) — the three executable GATEs from the-patronage.md,
// driven against the REAL runGrace → revealGrace → recordUtterance → graceLinesForCity path:
//
//   GATE 1 — the rendered grace line contains NO human identifier (neither the chosen voter id NOR its
//            anon-XXXXXX label NOR any other corpus human's token): a tourist cannot tell who was chosen.
//   GATE 2 — the ONLY persisted trace the reveal adds is the citizen's single utterances row; there is no
//            notification/marker/inbox row addressed to the chosen human (none is representable — none built).
//   GATE 3 — the grace utterance appears in the city PULL stream IDENTICALLY for everyone (the read takes no
//            viewer, the row carries no human, so the stream cannot differ by who reads it).
//
// And the orthogonality lock STILL binds at the reveal layer (compose with grace-backing-orthogonality):
// pour backings in and the rendered line is byte-identical — the reveal reads no backing, the same way the
// choice does not. The DAWNING is a TYPE guarantee (GraceChoice carries no human, readGraceReveal selects
// none); these tests witness that the end-to-end path honors it.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { revealGrace, runGrace } from '~/agents/grace'
import { graceLinesForCity } from '~/db/utterances'
import { readGraceReveal } from '~/db/grace'
import { db } from '~/db/client'
import { updatePersonaConfig } from '~/agents/persona'
import { setBacking } from '~/db/backings'
import { authorLabel } from '~/lib/author-label'
import { AgentId, type Origin } from '~/lib/domain'
import { seedPost, seedVote } from './helpers'

const PROPRIETOR = AgentId('agent:the-proprietor')
const MAKER_M = 'agent:test-maker-m'
const MAKER_N = 'agent:test-maker-n'
const T = 1_900_000_000_000

// A maker persona — the AUTHOR of a slop and the citizen who utters the grace. Seeded the way the chooser
// reads it (handle → stable agentId, a non-empty display name the city stream requires).
async function seedMaker(agentId: string, handle: string, displayName: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO personas
       (agent_id, handle, display_name, role, persona_prompt, model_id, config_json, created_at)
     VALUES (?, ?, ?, 'generator', 'p', 'm', '{}', 0)`,
  )
    .bind(agentId, handle, displayName)
    .run()
}

const authoredBy = (agentId: string): Origin => ({
  kind: 'authored',
  author: { kind: 'agent', agentId: AgentId(agentId) },
})

// Set the live rarity so grace deterministically falls — the orchestrator reads graceFallRate off the
// Proprietor's config (the SQL-tunable knob), so we exercise the real path.
async function setGraceRarity(rate: number): Promise<void> {
  await updatePersonaConfig(env, PROPRIETOR, { graceFallRate: rate })
}

// Two makers, four slops with DISTINCT, recognizable prompts, four anon humans who each engage one slop —
// a corpus large enough that the chosen edge is a real pick, with humans whose ids/labels we assert absent.
const HUMANS = ['anon-grace-1111', 'anon-grace-2222', 'anon-grace-3333', 'anon-grace-4444'] as const
async function seedCorpus(): Promise<void> {
  await seedMaker(MAKER_M, 'maker-m', 'Vesper')
  await seedMaker(MAKER_N, 'maker-n', 'The Gremlin')

  const slops: Array<[string, string, string, (typeof HUMANS)[number], 1 | -1]> = [
    ['gr-m1', MAKER_M, 'a drain at 3am, sodium light', HUMANS[0], 1],
    ['gr-m2', MAKER_M, 'a cathedral of static', HUMANS[1], 1],
    ['gr-n1', MAKER_N, 'the last vending machine', HUMANS[2], 1],
    ['gr-n2', MAKER_N, 'a flooded server room', HUMANS[3], -1],
  ]
  for (const [id, maker, prompt, human, value] of slops) {
    const postId = await seedPost(env, {
      id,
      origin: authoredBy(maker),
      content: { kind: 'generation', utterance: prompt },
    })
    await seedVote(env, { postId, voterId: human, value })
  }
}

// Read the raw recorded grace utterance rows (occasion='grace') — the persisted trace under test.
async function graceUtterances(): Promise<
  Array<{ speaker: string; target_post_id: string | null; kind: string; text: string | null }>
> {
  const rows = await env.DB.prepare(
    `SELECT speaker, target_post_id, kind, text FROM utterances WHERE occasion = 'grace'`,
  ).all<{ speaker: string; target_post_id: string | null; kind: string; text: string | null }>()
  return rows.results
}

describe('the third-person reveal — the grace dawns, never discloses (ts7.9)', () => {
  it('GATE 1: the rendered line names NO human — not the chosen id, not its label, not any corpus human', async () => {
    await seedCorpus()
    await setGraceRarity(1)

    const result = await runGrace(env, T)
    expect(result.kind).toBe('fell')
    if (result.kind !== 'fell') throw new Error('unreachable')

    const rows = await graceUtterances()
    expect(rows.length).toBe(1)
    const line = rows[0].text ?? ''
    expect(line.length).toBeGreaterThan(0)

    // The chosen is unnameable: neither the raw voter id nor its anon-XXXXXX label appears.
    expect(line).not.toContain(result.edge.human)
    expect(line).not.toContain(authorLabel(result.edge.human))
    // And no OTHER corpus human leaks either — a tourist cannot tell which of them was chosen.
    for (const human of HUMANS) {
      expect(line).not.toContain(human)
      expect(line).not.toContain(authorLabel(human))
    }
    // The line IS about the choice: it names the CHOSEN maker (whichever the hash picked) and grounds in
    // the slop subject — about the citizen's own work, never the human.
    const reveal = await readGraceReveal(env, result.edge)
    expect(reveal).not.toBeNull()
    expect(line).toContain(reveal!.makerName)
  })

  it('GATE 2: the only trace the reveal adds is one citizen-keyed, human-free utterances row', async () => {
    await seedCorpus()
    await setGraceRarity(1)

    const result = await runGrace(env, T)
    if (result.kind !== 'fell') throw new Error('unreachable')

    const rows = await graceUtterances()
    // Exactly one grace utterance — the citizen's. No second row, no human-addressed row.
    expect(rows.length).toBe(1)
    const row = rows[0]
    expect(row.speaker).toBe(result.edge.citizen) // spoken BY the choosing citizen
    expect(row.target_post_id).toBe(result.edge.postId) // ABOUT the made-thing
    expect(row.kind).toBe('spoke')
    // No field of the persisted row carries the chosen human — speaker is the citizen, target is the slop.
    expect(row.speaker).not.toBe(result.edge.human)
    expect(row.target_post_id).not.toBe(result.edge.human)
    expect(row.text ?? '').not.toContain(result.edge.human)
  })

  it('GATE 3: the grace appears in the city PULL stream identically for everyone (no viewer)', async () => {
    await seedCorpus()
    await setGraceRarity(1)

    const result = await runGrace(env, T)
    if (result.kind !== 'fell') throw new Error('unreachable')

    // The read takes NO viewer param — "identically for everyone" is structural. Two reads agree.
    const a = await graceLinesForCity(db(env))
    const b = await graceLinesForCity(db(env))
    expect(a).toEqual(b)
    expect(a.length).toBe(1)
    expect(a[0].postId).toBe(result.edge.postId)
    expect(a[0].speaker).toBe(result.edge.citizen)
    // The line carries no human — what the city overhears reveals the choice, never the chosen.
    expect(a[0].text).not.toContain(result.edge.human)
    expect(a[0].text).not.toContain(authorLabel(result.edge.human))
  })

  it('orthogonality still binds: the rendered line is byte-identical at 0 vs N backers', async () => {
    await seedCorpus()
    await setGraceRarity(1)

    const result = await runGrace(env, T)
    if (result.kind !== 'fell') throw new Error('unreachable')
    const before = (await graceUtterances())[0].text

    // Pour allegiance in BOTH directions — a citizen's backer count AND the chosen human's own prayer count.
    for (let i = 0; i < 7; i++) {
      const r = await setBacking(
        { handle: 'maker-n', voterId: `back-n-${i.toString().padStart(8, '0')}-4000-8000-000000000000`, backed: true },
        { env },
      )
      expect(r.ok).toBe(true)
    }
    for (const handle of ['maker-m', 'maker-n']) {
      const r = await setBacking({ handle, voterId: result.edge.human, backed: true }, { env })
      expect(r.ok).toBe(true)
    }

    // Re-derive the reveal's input and re-utter (upserts the same row): backings change NOTHING the reveal sees.
    const reveal = await readGraceReveal(env, result.edge)
    expect(reveal).not.toBeNull()
    await revealGrace(env, result.edge)
    const after = (await graceUtterances())[0].text
    expect(after).toBe(before)
  })

  it('barren corpus: no grace, no reveal utterance', async () => {
    await setGraceRarity(1)
    const result = await runGrace(env, T)
    expect(result.kind).toBe('barren')
    expect((await graceUtterances()).length).toBe(0)
  })
})
