// [LAW:behavior-not-structure] Pins the data-selection at the core of the personal
// reveal: getFeed / getFeedItemById derive RenderablePost.viewerIsModifier from the
// stored human modifier vs the reading viewer — TRUE only when the viewer is the
// wisher, FALSE for a stranger and for an anonymous (no-cookie) reader. The card's
// second-person copy rides this bit, so this is where "render as the wisher vs a
// stranger" is verified against real D1 rows (not a mock).
//
// [LAW:single-enforcer] The full voter UUID is never written to origin_json — the
// write side redacts via authorLabel before storing — so the wisher's stored identity
// is the anon LABEL, and the comparison is label-to-label. This test seeds exactly
// that shape and asserts the boundary computes the bit honestly.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { getFeedPage, getFeedItemById } from '~/db/feed'
import { authorLabel } from '~/lib/author-label'
import { AgentId, type Origin, type PostId } from '~/lib/domain'
import { seedPost } from './helpers'

// A UUID whose first 6 chars drive its anon label. authorLabel takes the first 6
// chars, so this id's wisher label is deterministic and distinct from the stranger's.
const WISHER_ID = 'abc12300-0000-4000-8000-000000000000'
const STRANGER_ID = 'def45600-0000-4000-8000-000000000000'

function wishedOrigin(wisherVoterId: string): Origin {
  return {
    kind: 'authored',
    author: { kind: 'agent', agentId: AgentId('sys:test') },
    // The write side stores the REDACTED label, never the raw UUID. [single-enforcer]
    human: { role: 'wisher', by: { kind: 'anon', label: authorLabel(wisherVoterId) } },
  }
}

async function seedWishedSlop(): Promise<PostId> {
  return seedPost(env, {
    id: 'wished-slop',
    origin: wishedOrigin(WISHER_ID),
    content: { kind: 'generation', wish: 'a quiet blue horse, please' },
  })
}

describe('app/db/feed.ts - viewerIsModifier (the personal reveal)', () => {
  it('getFeedItemById: TRUE when the viewer IS the wisher', async () => {
    const id = await seedWishedSlop()
    const item = await getFeedItemById(env, id, WISHER_ID)
    expect(item).not.toBeNull()
    expect(item!.viewerIsModifier).toBe(true)
  })

  it('getFeedItemById: FALSE for a stranger - we never tell them "what YOU wished"', async () => {
    const id = await seedWishedSlop()
    const item = await getFeedItemById(env, id, STRANGER_ID)
    expect(item!.viewerIsModifier).toBe(false)
  })

  it('getFeedItemById: FALSE for an anonymous (no-cookie) reader', async () => {
    const id = await seedWishedSlop()
    const item = await getFeedItemById(env, id, undefined)
    expect(item!.viewerIsModifier).toBe(false)
  })

  it('getFeedPage: the same post is personal to the wisher and spectacle to a stranger', async () => {
    const id = await seedWishedSlop()
    const asWisher = (await getFeedPage(env, { voterId: WISHER_ID })).items.find((f) => f.post.id === id)
    const asStranger = (await getFeedPage(env, { voterId: STRANGER_ID })).items.find((f) => f.post.id === id)
    expect(asWisher!.viewerIsModifier).toBe(true)
    expect(asStranger!.viewerIsModifier).toBe(false)
  })

  it('a non-wished slop is never personal - no human modifier, no "you"', async () => {
    // Default origin has no human modifier; viewerIsModifier is false for everyone,
    // even the actor whose label might otherwise collide.
    const id = await seedPost(env, { id: 'plain-slop' })
    const item = await getFeedItemById(env, id, WISHER_ID)
    expect(item!.viewerIsModifier).toBe(false)
  })
})
