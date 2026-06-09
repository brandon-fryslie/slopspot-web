// [LAW:behavior-not-structure] The Unanswered Prayer's load-bearing invariant-lock (ts7.4):
// BACKING IS INERT TOWARD GENOME FITNESS. The patronage epic runs the social graph human->machine —
// a human backs a citizen — and that allegiance must NEVER leak into which genomes breed. Today the
// selection path (getNicheGenePool -> selectReproduction) reads only votes; backings is absent by
// construction. This test converts that currently-true structural fact into an ENFORCED contract: it
// drives the REAL selection path over genomes whose makers carry varied backer counts and asserts the
// gene pool and the reproduction plan are byte-identical to a backer-free baseline. [LAW:make-it-impossible]
// "backing influences genome fitness" becomes a state a future edit cannot reach without this test
// going red.
//
// WHY this is not a grep: a structural assertion ("the string `backings` is absent from genepool.ts")
// tests HOW and drifts — an aliased import or a join through posts.origin would slip past it. The honest
// contract is behavioral: run the selection with 0 vs N backers on the SAME genomes and demand the same
// answer. It exercises the actual D1 read seam where a leak would be introduced.
//
// HOW it would fail if backing were wired in: the genomes here are authored by a maker, and a maker is
// backed N times through the REAL writer (setBacking). The single most plausible future leak — "a genome
// authored by a well-backed maker gets a fitness boost" (a join generations->posts.origin->backings) —
// would change a candidate's fitness the moment backers are added, reordering or rescaling the pool and
// breaking the toEqual below. The peer authored by the heavily-backed maker would jump the blessed line.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { getNicheGenePool, type Niche } from '~/db/genepool'
import { selectReproduction, type ReproductionPlan } from '~/firehose/select'
import { setBacking } from '~/db/backings'
import { AgentId, PostId, type Origin } from '~/lib/domain'
import { seedPost, seedVote } from './helpers'

// The fixed "now" matching seedVote's default createdAt -> vote age 0 -> recency weight exactly 1, so
// fitness here is the raw bloodline sum and the assertions read cleanly. Mirrors genepool.test.ts.
const NOW = new Date('2026-01-01T00:00:00Z').getTime()

const ST_VIVIAN = 'voter:st-vivian'
const citizenNiche = (voterId: string): Niche => ({ kind: 'citizen', voterId })
const populist: Niche = { kind: 'populist', citizenVoterIds: [ST_VIVIAN] }

// A maker persona — the AUTHOR of a genome and the citizen a human can back. The selection path never
// reads authorship today; we attach it precisely so a future author-backer leak would have something to
// grab. Seeded the way setBacking reads it (handle -> stable agentId), mirroring backings.test.ts.
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

// Back `citizen`'s handle from `n` distinct human voters through the REAL writer — the same path any
// future "fitness reads backers" edit would have to consult. Distinct UUID voters so the COUNT is n.
async function backNTimes(handle: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const voterId = `back-${handle}-${i.toString().padStart(8, '0')}-4000-8000-000000000000`
    const res = await setBacking({ handle, voterId, backed: true }, { env })
    expect(res.ok).toBe(true)
  }
}

// The blessed-line + rival-peer scenario, authored across two makers so an author-backer leak would
// REORDER the pool, not merely rescale it. St. Vivian blesses every node once:
//   maker M:  g0 -> g1 -> g2   (bloodline fitness 3, 2, 1)
//   maker N:  peer             (fitness 1)
// Returns the niche to read. Both makers exist as personas so either can be backed.
const MAKER_M = 'agent:test-maker-m'
const MAKER_N = 'agent:test-maker-n'

async function seedScenario(): Promise<void> {
  await seedMaker(MAKER_M, 'maker-m')
  await seedMaker(MAKER_N, 'maker-n')

  const g0 = await seedPost(env, { id: 'og-g0', origin: authoredBy(MAKER_M), content: { kind: 'generation' } })
  const g1 = await seedPost(env, { id: 'og-g1', origin: authoredBy(MAKER_M), content: { kind: 'generation', parentId: g0 } })
  const g2 = await seedPost(env, { id: 'og-g2', origin: authoredBy(MAKER_M), content: { kind: 'generation', parentId: g1 } })
  const peer = await seedPost(env, { id: 'og-peer', origin: authoredBy(MAKER_N), content: { kind: 'generation' } })

  for (const p of [g0, g1, g2, peer]) {
    await seedVote(env, { postId: p, voterId: ST_VIVIAN, value: 1, reasoning: 'agent verdict' })
  }
}

// A seed (searched once, hard-coded) under which the baseline plan is a real CROSS, so the test locks
// the PARENT-SELECTION path — fitness-weighted draw of two parents — not just founder resolution.
const BRED_SEED = (() => {
  // Three candidates with fitness 3,2,1 (the scenario's shape) — find a seed whose plan is 'bred'.
  const shape = [
    { ref: PostId('og-g0'), fitness: 3 },
    { ref: PostId('og-g1'), fitness: 2 },
    { ref: PostId('og-peer'), fitness: 1 },
  ]
  for (let s = 1; s < 200; s++) {
    if (selectReproduction(shape, s).kind === 'bred') return s
  }
  throw new Error('no bred seed found in range — scenario shape changed')
})()

describe('selection-backing orthogonality — backing is inert toward genome fitness (ts7.4)', () => {
  it('the citizen-niche gene pool AND the reproduction plan are identical at 0 vs N backers', async () => {
    await seedScenario()
    const niche = citizenNiche(ST_VIVIAN)

    const baselinePool = await getNicheGenePool(env, niche, 50, NOW)
    const baselinePlan = selectReproduction(baselinePool, BRED_SEED)

    // Guard against a VACUOUS pass: the baseline must be a non-trivial, multi-tier pool and a real cross,
    // so "identical" is a meaningful claim and the parent-selection path is genuinely exercised.
    expect(baselinePool.length).toBe(4)
    expect(new Set(baselinePool.map((c) => c.fitness)).size).toBeGreaterThan(1)
    expect(baselinePlan.kind).toBe('bred')

    // Now pour allegiance onto the makers — asymmetrically, so an author-backer leak would REORDER:
    // the rival peer's maker gets a crowd, the blessed line's maker gets none.
    await backNTimes('maker-n', 7)
    await backNTimes('maker-m', 0)

    const afterPool = await getNicheGenePool(env, niche, 50, NOW)
    const afterPlan = selectReproduction(afterPool, BRED_SEED)

    // The whole contract, in two lines: backing changed nothing the selection path can see.
    expect(afterPool).toEqual(baselinePool)
    expect(afterPlan).toEqual<ReproductionPlan>(baselinePlan)
  })

  it('the populist-niche gene pool is identical at 0 vs N backers (the popular line is inert too)', async () => {
    await seedMaker(MAKER_M, 'maker-m')
    const a = await seedPost(env, { id: 'op-a', origin: authoredBy(MAKER_M), content: { kind: 'generation' } })
    const b = await seedPost(env, { id: 'op-b', origin: authoredBy(MAKER_M), content: { kind: 'generation' } })
    // Human votes feed the populist niche (cast citizens are excluded from it by construction).
    await seedVote(env, { postId: a, voterId: 'anon-h1', value: 1 })
    await seedVote(env, { postId: a, voterId: 'anon-h2', value: 1 })
    await seedVote(env, { postId: b, voterId: 'anon-h1', value: 1 })

    const baseline = await getNicheGenePool(env, populist, 50, NOW)
    expect(baseline.length).toBe(2)

    await backNTimes('maker-m', 5)

    expect(await getNicheGenePool(env, populist, 50, NOW)).toEqual(baseline)
  })
})
