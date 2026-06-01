// [LAW:behavior-not-structure] Pins the backing contract against a real D1 isolate:
// backing a citizen raises the derived count and marks the viewer backed; unbacking
// lowers it and clears the viewer state; the (voter, citizen) pair is unique; the
// count is a COUNT of rows (proven by aggregating across voters), never a stored
// tally; an unknown handle is citizen_not_found. The edge only round-trips correctly
// through a real personas row (setBacking resolves the handle), so the test seeds
// personas the way the live writer reads them.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { getBackings, setBacking } from '~/db/backings'
import { AgentId } from '~/lib/domain'

// Seed a citizen the way the personas writer would — setBacking resolves the
// handle to this row's stable agentId, which is what the backing edge stores.
async function seedCitizen(opts: {
  agentId: string
  handle: string
  role?: string
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO personas
       (agent_id, handle, display_name, role, persona_prompt, model_id, config_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      opts.agentId,
      opts.handle,
      `Test ${opts.handle}`,
      opts.role ?? 'generator',
      'p',
      'm',
      '{}',
      0,
    )
    .run()
}

const VOTER_A = '11111111-1111-4111-8111-111111111111'
const VOTER_B = '22222222-2222-4222-8222-222222222222'

describe('setBacking + getBackings', () => {
  it('back -> count+1 and viewer backed; unback -> count-1 and viewer not backed', async () => {
    await seedCitizen({ agentId: 'agent:test-gm', handle: 'test-guttermonk' })
    const citizen = AgentId('agent:test-gm')

    // Before: no one backs him.
    const before = await getBackings(env, [citizen], VOTER_A)
    expect(before.get('agent:test-gm')).toEqual({ backerCount: 0, viewerBacks: false })

    // Back him.
    const backed = await setBacking(
      { handle: 'test-guttermonk', voterId: VOTER_A, backed: true },
      { env },
    )
    expect(backed).toEqual({ ok: true, backerCount: 1, backed: true })

    const afterBack = await getBackings(env, [citizen], VOTER_A)
    expect(afterBack.get('agent:test-gm')).toEqual({ backerCount: 1, viewerBacks: true })

    // Unback him.
    const unbacked = await setBacking(
      { handle: 'test-guttermonk', voterId: VOTER_A, backed: false },
      { env },
    )
    expect(unbacked).toEqual({ ok: true, backerCount: 0, backed: false })

    const afterUnback = await getBackings(env, [citizen], VOTER_A)
    expect(afterUnback.get('agent:test-gm')).toEqual({ backerCount: 0, viewerBacks: false })
  })

  it('is idempotent - backing twice keeps one row per voter per citizen', async () => {
    await seedCitizen({ agentId: 'agent:test-gm', handle: 'test-guttermonk' })

    const first = await setBacking(
      { handle: 'test-guttermonk', voterId: VOTER_A, backed: true },
      { env },
    )
    const second = await setBacking(
      { handle: 'test-guttermonk', voterId: VOTER_A, backed: true },
      { env },
    )
    expect(first.ok && first.backerCount).toBe(1)
    // The PK collapses the duplicate pledge — still one backer, not two.
    expect(second.ok && second.backerCount).toBe(1)
  })

  it('counts backers across voters - the count is a COUNT of rows, not a tally', async () => {
    await seedCitizen({ agentId: 'agent:test-gm', handle: 'test-guttermonk' })
    const citizen = AgentId('agent:test-gm')

    await setBacking({ handle: 'test-guttermonk', voterId: VOTER_A, backed: true }, { env })
    const afterB = await setBacking(
      { handle: 'test-guttermonk', voterId: VOTER_B, backed: true },
      { env },
    )
    expect(afterB.ok && afterB.backerCount).toBe(2)

    // Each viewer sees the same count but their OWN backed-state.
    const seenByA = await getBackings(env, [citizen], VOTER_A)
    expect(seenByA.get('agent:test-gm')).toEqual({ backerCount: 2, viewerBacks: true })

    const seenByAnon = await getBackings(env, [citizen], undefined)
    expect(seenByAnon.get('agent:test-gm')).toEqual({ backerCount: 2, viewerBacks: false })

    // A withdraws — the count drops, B's backing remains.
    await setBacking({ handle: 'test-guttermonk', voterId: VOTER_A, backed: false }, { env })
    const seenByB = await getBackings(env, [citizen], VOTER_B)
    expect(seenByB.get('agent:test-gm')).toEqual({ backerCount: 1, viewerBacks: true })
  })

  it('batches the whole roster in one read, defaulting un-backed citizens', async () => {
    await seedCitizen({ agentId: 'agent:test-gm', handle: 'test-guttermonk' })
    await seedCitizen({ agentId: 'agent:test-vs', handle: 'test-vesper' })
    await setBacking({ handle: 'test-guttermonk', voterId: VOTER_A, backed: true }, { env })

    const roster = await getBackings(
      env,
      [AgentId('agent:test-gm'), AgentId('agent:test-vs')],
      VOTER_A,
    )
    expect(roster.get('agent:test-gm')).toEqual({ backerCount: 1, viewerBacks: true })
    // Vesper has no backers — absent from the GROUP BY, defaulted here.
    expect(roster.get('agent:test-vs')).toEqual({ backerCount: 0, viewerBacks: false })
  })

  it('an unknown handle is citizen_not_found, not a write', async () => {
    const result = await setBacking(
      { handle: 'nobody-here', voterId: VOTER_A, backed: true },
      { env },
    )
    expect(result).toEqual({ ok: false, reason: 'citizen_not_found' })
  })

  it('an empty roster reads as an empty map without querying IN ()', async () => {
    const empty = await getBackings(env, [], VOTER_A)
    expect(empty.size).toBe(0)
  })
})
