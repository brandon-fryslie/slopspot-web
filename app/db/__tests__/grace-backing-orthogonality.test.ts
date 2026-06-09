// [LAW:behavior-not-structure] Grace Falls' load-bearing invariant (ts7.8): GRACE IS BACKINGS-BLIND, and
// it is a real corpus FOLD. This is the SECOND half of the orthogonality lock ts7.4 began (that test pinned
// "backing is inert toward GENOME FITNESS"; this one pins "backing is inert toward the GRACE edge"). The CD
// ruling (ts7.4 comment, 2026-06-05): backing's only behavioral output is the Wing knife — it touches
// neither genome fitness nor the grace-selection that records the citizen→human edge.
//
// The doc's three GATEs, made executable against the REAL readGraceCorpus → chooseGrace → runGrace path:
//   (a) grace CAN land on a human who never backed any citizen,
//   (b) grace is INVARIANT to backings — pour allegiance in (both directions: a citizen's backer count AND
//       a human's own backing count) and the corpus, the choice, and the recorded edge are byte-identical,
//   (c) grace REPLAYS DIFFERENTLY when corpus state changes (a fold, not a constant).
//
// WHY this is not a grep: a structural assertion ("`backings` is absent from grace.ts") tests HOW and
// drifts — an aliased import or a join through posts would slip past it. The honest contract is behavioral:
// run the selection with 0 vs N backers on the SAME corpus and demand the same answer, exercising the
// actual D1 read seam where a leak would be introduced. The single most plausible future leak — "a human
// who backs a citizen is more likely to receive its grace" (a join graces-chooser → backings) — would
// change the chosen edge the moment backers are added, breaking the toEqual below.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { readGraceCorpus, recordGrace } from '~/db/grace'
import { runGrace } from '~/agents/grace'
import { chooseGrace } from '~/lib/grace'
import { setBacking } from '~/db/backings'
import { updatePersonaConfig } from '~/agents/persona'
import { AgentId, type Origin } from '~/lib/domain'
import { seedPost, seedVote } from './helpers'

const PROPRIETOR = AgentId('agent:the-proprietor')

// A maker persona — the AUTHOR of a slop and the citizen who may extend grace. Seeded the way setBacking
// reads it (handle → stable agentId), mirroring backings.test.ts / the ts7.4 orthogonality test.
async function seedMaker(agentId: string, handle: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO personas
       (agent_id, handle, display_name, role, persona_prompt, model_id, config_json, created_at)
     VALUES (?, ?, ?, 'generator', 'p', 'm', '{}', 0)`,
  )
    .bind(agentId, handle, `Test ${handle}`)
    .run()
}

const authoredBy = (agentId: string): Origin => ({
  kind: 'authored',
  author: { kind: 'agent', agentId: AgentId(agentId) },
})

// Set the live rarity so grace deterministically falls when the corpus is non-empty — the orchestrator
// reads graceFallRate off the Proprietor's config (the SQL-tunable knob), so we exercise that real path.
async function setGraceRarity(rate: number): Promise<void> {
  await updatePersonaConfig(env, PROPRIETOR, { graceFallRate: rate })
}

// Back `citizen`'s handle from `n` distinct human voters through the REAL writer — the citizen's BACKER
// COUNT rises (the leak "a well-backed citizen gives grace differently" would consult this). Distinct UUID
// voters so the count is n. Mirrors the ts7.4 helper.
async function backCitizenNTimes(handle: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const voterId = `back-${handle}-${i.toString().padStart(8, '0')}-4000-8000-000000000000`
    const res = await setBacking({ handle, voterId, backed: true }, { env })
    expect(res.ok).toBe(true)
  }
}

// Have ONE human back every listed citizen handle — the human's OWN prayer count rises (the leak "a human
// who prays more receives grace more" would consult this). The other direction of the same invariant.
async function humanBacks(human: string, handles: readonly string[]): Promise<void> {
  for (const handle of handles) {
    const res = await setBacking({ handle, voterId: human, backed: true }, { env })
    expect(res.ok).toBe(true)
  }
}

const MAKER_M = 'agent:test-maker-m'
const MAKER_N = 'agent:test-maker-n'
const T = 1_900_000_000_000

// Two makers, four slops, four anon humans who each bless one slop — a multi-citizen, multi-human corpus so
// a backer leak would REORDER the eligible edges, not merely rescale. Every human here is a NEVER-BACKER by
// construction (no humanBacks call), so the corpus is the never-backer-eligibility fixture too.
async function seedCorpus(): Promise<void> {
  await seedMaker(MAKER_M, 'maker-m')
  await seedMaker(MAKER_N, 'maker-n')

  const m1 = await seedPost(env, { id: 'gr-m1', origin: authoredBy(MAKER_M), content: { kind: 'generation' } })
  const m2 = await seedPost(env, { id: 'gr-m2', origin: authoredBy(MAKER_M), content: { kind: 'generation' } })
  const n1 = await seedPost(env, { id: 'gr-n1', origin: authoredBy(MAKER_N), content: { kind: 'generation' } })
  const n2 = await seedPost(env, { id: 'gr-n2', origin: authoredBy(MAKER_N), content: { kind: 'generation' } })

  await seedVote(env, { postId: m1, voterId: 'anon-grace-1', value: 1 })
  await seedVote(env, { postId: m2, voterId: 'anon-grace-2', value: 1 })
  await seedVote(env, { postId: n1, voterId: 'anon-grace-3', value: 1 })
  await seedVote(env, { postId: n2, voterId: 'anon-grace-4', value: -1 })
}

async function graceRowCount(): Promise<number> {
  const rows = await env.DB.prepare('SELECT COUNT(*) AS c FROM graces').all<{ c: number }>()
  return rows.results[0].c
}

describe('grace-backing orthogonality — grace is backings-blind and a real corpus fold (ts7.8)', () => {
  it('GATE (a): the corpus is built from engagement, so grace lands on humans who never backed', async () => {
    await seedCorpus()
    await setGraceRarity(1)

    const corpus = await readGraceCorpus(env)
    // Four engagement edges — one per blessed slop. Every human is a never-backer (nobody called humanBacks).
    expect(corpus.edges.length).toBe(4)
    const humans = corpus.edges.map((e) => e.human).sort()
    expect(humans).toEqual(['anon-grace-1', 'anon-grace-2', 'anon-grace-3', 'anon-grace-4'])
    // An edge a downvoter created is eligible too — engagement is not approval; grace is not merit.
    expect(corpus.edges.some((e) => e.human === 'anon-grace-4')).toBe(true)

    const result = await runGrace(env, T)
    expect(result.kind).toBe('fell')
    if (result.kind !== 'fell') throw new Error('unreachable')
    // The chosen human has NO backing row — grace fell on a human who never backed any citizen.
    const backed = await env.DB.prepare('SELECT COUNT(*) AS c FROM backings WHERE voter_id = ?')
      .bind(result.edge.human)
      .all<{ c: number }>()
    expect(backed.results[0].c).toBe(0)
  })

  it('GATE (b): the corpus AND the choice AND the recorded edge are identical at 0 vs N backers', async () => {
    await seedCorpus()
    await setGraceRarity(1)

    const baselineCorpus = await readGraceCorpus(env)
    const baselineChoice = chooseGrace(baselineCorpus, T, 1)
    expect(baselineChoice).not.toBeNull()

    // Pour allegiance in BOTH directions, asymmetrically, so a leak in either would reorder the edges:
    //  - citizen backer counts: maker-n gets a crowd, maker-m gets none.
    //  - a human's own prayer count: the human the baseline grace would touch backs every maker.
    await backCitizenNTimes('maker-n', 7)
    await backCitizenNTimes('maker-m', 0)
    await humanBacks(baselineChoice!.human, ['maker-m', 'maker-n'])

    const afterCorpus = await readGraceCorpus(env)
    const afterChoice = chooseGrace(afterCorpus, T, 1)

    // The whole contract: backing changed nothing the grace path can see.
    expect(afterCorpus).toEqual(baselineCorpus)
    expect(afterChoice).toEqual(baselineChoice)

    // And end-to-end: the recorded grace edge is the backing-free choice (rarity path included).
    const run = await runGrace(env, T)
    expect(run.kind).toBe('fell')
    if (run.kind !== 'fell') throw new Error('unreachable')
    expect(run.edge).toEqual(baselineChoice)
  })

  it('GATE (c): grace replays differently when corpus state changes — a fold, not a constant', async () => {
    await seedCorpus()
    const before = await readGraceCorpus(env)

    // A new human blesses a new slop — the corpus grows. A constant would ignore this; a fold reflects it.
    const fresh = await seedPost(env, { id: 'gr-m3', origin: authoredBy(MAKER_M), content: { kind: 'generation' } })
    await seedVote(env, { postId: fresh, voterId: 'anon-grace-5', value: 1 })
    const after = await readGraceCorpus(env)

    expect(after.edges.length).toBe(before.edges.length + 1)
    expect(after).not.toEqual(before)

    // There exists a tick whose chosen edge differs between the two corpus states (searched, then asserted).
    let diverged = false
    for (let i = 0; i < 500; i++) {
      const t = T + i
      if (JSON.stringify(chooseGrace(before, t, 1)) !== JSON.stringify(chooseGrace(after, t, 1))) {
        diverged = true
        break
      }
    }
    expect(diverged).toBe(true)
  })

  it('records at most one grace per day — a re-fire of the same tick is idempotent', async () => {
    await seedCorpus()
    await setGraceRarity(1)

    const first = await runGrace(env, T)
    expect(first.kind).toBe('fell')
    expect(await graceRowCount()).toBe(1)

    // Same scheduled time → same UTC grace_day → the UNIQUE index discards the second record.
    const second = await runGrace(env, T)
    expect(second.kind).toBe('already-fell')
    expect(await graceRowCount()).toBe(1)
  })

  it('an empty corpus is barren — no grace falls, none recorded', async () => {
    await setGraceRarity(1)
    const result = await runGrace(env, T)
    expect(result.kind).toBe('barren')
    expect(await graceRowCount()).toBe(0)
  })

  it('recordGrace surfaces the settled edge on a same-day conflict (idempotency recovery)', async () => {
    await seedCorpus()
    const day = '2030-04-01'
    const first = await recordGrace(env, {
      citizen: AgentId(MAKER_M),
      human: 'anon-grace-1',
      postId: (await readGraceCorpus(env)).edges[0].postId,
      graceDay: day,
    })
    expect(first.recorded).toBe(true)

    const second = await recordGrace(env, {
      citizen: AgentId(MAKER_N),
      human: 'anon-grace-9',
      postId: (await readGraceCorpus(env)).edges[0].postId,
      graceDay: day,
    })
    expect(second.recorded).toBe(false)
    if (second.recorded) throw new Error('unreachable')
    // The authoritative edge is the FIRST one recorded, not the second caller's discarded re-choice.
    expect(second.existing.citizen).toBe(MAKER_M)
    expect(second.existing.human).toBe('anon-grace-1')
  })
})
