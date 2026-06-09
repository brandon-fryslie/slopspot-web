// [LAW:behavior-not-structure] Pin the museum orchestrator's contract: a hall shows the
// crowns of exactly its lenses (the partition), zipped to their posts' images, in crown
// order; an empty hall is an empty entry list. The zip + image-narrowing is the only logic
// this module owns (crowns.ts and feed.ts are pinned in their own suites), so that is what
// is asserted here against a real D1 isolate.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { recordCrowning } from '~/db/crowns'
import { loadMuseumHall } from '~/db/museum'
import { AgentId } from '~/lib/domain'
import { spoke } from '~/lib/voice'
import { seedPost } from './helpers'

const HOST = AgentId('agent:test-presider')

async function crown(riteDay: string, lens: Parameters<typeof recordCrowning>[1]['lens']) {
  const post = await seedPost(env)
  await recordCrowning(env, {
    postId: post,
    riteDay,
    lens,
    presiding: HOST,
    decree: spoke(`Decree for ${lens}.`),
  })
  return post
}

describe('loadMuseumHall — the two halls, partitioned', () => {
  it('the Calendar of Saints holds the venerated lenses, newest-first, with images', async () => {
    const relic = await crown('2026-05-10', 'relic')
    const saint = await crown('2026-05-12', 'saint')
    await crown('2026-05-14', 'villain') // the other hall

    const hall = await loadMuseumHall(env, 'saints')
    expect(hall.hall).toBe('saints')
    // saint (later day) precedes relic; the villain is absent (Rogues' Gallery).
    expect(hall.entries.map((e) => e.postId)).toEqual([saint, relic])
    expect(hall.entries[0].lens).toBe('saint')
    expect(hall.entries[0].mark).toBe('gold')
    expect(hall.entries[0].media.kind).toBe('image')
    expect(hall.entries[0].decree).toEqual(spoke('Decree for saint.'))
  })

  it('the Rogues’ Gallery holds only the monsters (villain, heretic)', async () => {
    await crown('2026-05-10', 'saint')
    const villain = await crown('2026-05-12', 'villain')
    const heretic = await crown('2026-05-13', 'heretic')

    const hall = await loadMuseumHall(env, 'rogues')
    expect(hall.entries.map((e) => e.postId)).toEqual([heretic, villain])
    expect(hall.entries.every((e) => e.mark === 'magenta')).toBe(true)
  })

  it('an empty hall yields no entries (the honest quiet)', async () => {
    const hall = await loadMuseumHall(env, 'saints')
    expect(hall.entries).toEqual([])
  })
})
