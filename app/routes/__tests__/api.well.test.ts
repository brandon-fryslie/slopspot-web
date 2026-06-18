// [LAW:behavior-not-structure] Pins /api/well's contract — the status-code map and
// the D1 side-effects of a wish: a slop AUTHORED by the seated persona, the human a
// `wisher` modifier, the wish persisted, and the signed remark recorded. Runs against
// real D1 (workers project); only ingestImage is mocked, so no network fetch of the
// mock provider's image URL makes the test flaky — everything else is real SQL.
//
// The seated persona is forced by replacing the seeded generator pool with a single
// mock-medium citizen, so seatCitizen's weighted-random draw is deterministic (one
// candidate) and the provider call is the free mock. Persona writes roll back per
// test under isolatedStorage.

import { describe, expect, it, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'

// Mock the one network seam: ingestImage fetches the provider's image URL. Replace
// it with a fixed content-addressed result so createPost's generation lifecycle runs
// end-to-end without leaving the isolate.
vi.mock('~/storage/ingest', () => ({
  ingestImage: vi.fn(async () => ({
    url: '/media/test-fake',
    key: 'test-fake',
    size: 1,
    contentType: 'image/png',
  })),
}))

// These cases pin the Well's AUTHORING contract, which exists whether or not the surface is
// currently reachable. Mock the gate OPEN so the flow runs; the gated-closed behavior (404
// before any side effect) is pinned in api.well.gate.test.ts. [LAW:single-enforcer]
vi.mock('~/lib/well-gate', () => ({ WELL_REACHABLE: true }))

import { action } from '~/routes/api.well'
import { getPostById } from '~/db/feed'
import { db } from '~/db/client'
import { personas, generations } from '~/db/schema'
import { PostId } from '~/lib/domain'

const stubCtx: ExecutionContext = {
  waitUntil() {},
  passThroughOnException() {},
  exports: {} as Cloudflare.Exports,
  props: {},
}

function actionArgs(init: {
  method?: string
  body?: string
  contentType?: string
  origin?: string
  cookie?: string
}): Parameters<typeof action>[0] {
  const url = new URL('https://slopspot.ai/api/well')
  const headers: Record<string, string> = {}
  if (init.contentType !== undefined) headers['content-type'] = init.contentType
  if (init.origin !== undefined) headers['origin'] = init.origin
  if (init.cookie !== undefined) headers['cookie'] = init.cookie
  return {
    params: {},
    context: { cloudflare: { env, ctx: stubCtx } },
    request: new Request(url, {
      method: init.method ?? 'POST',
      body: init.body,
      headers,
    }),
    url,
    pattern: '/api/well',
  } as Parameters<typeof action>[0]
}

const VALID_BODY = JSON.stringify({ wish: 'a lighthouse at the end of the world' })

// Replace the seeded generators with one mock-medium citizen so seating is
// deterministic and the provider call is free.
async function seatOnlyMockGenerator(agentId: string) {
  await db(env).delete(personas).where(eq(personas.role, 'generator'))
  await db(env).insert(personas).values({
    agentId,
    handle: agentId.replace('agent:', ''),
    displayName: 'The Test Spirit',
    role: 'generator',
    personaPrompt: 'a deadpan maker who worships garbage',
    modelId: 'claude-haiku-4-5',
    configJson: JSON.stringify({ medium: 'fal-flux-mock' }),
    createdAt: new Date(),
  })
}

describe('POST /api/well - gates', () => {
  it('returns 405 for GET', async () => {
    const res = await action(actionArgs({ method: 'GET' }))
    expect(res.status).toBe(405)
  })

  it('returns 403 when Origin is cross-site', async () => {
    const res = await action(
      actionArgs({ body: VALID_BODY, contentType: 'application/json', origin: 'https://evil.example' }),
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 on malformed JSON', async () => {
    const res = await action(actionArgs({ body: 'not json', contentType: 'application/json' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when the wish is whitespace-only (trims to empty)', async () => {
    const res = await action(
      actionArgs({ body: JSON.stringify({ wish: '   ' }), contentType: 'application/json' }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 503 when the city has no spirit to seat (no generator personas)', async () => {
    await db(env).delete(personas).where(eq(personas.role, 'generator'))
    const res = await action(actionArgs({ body: VALID_BODY, contentType: 'application/json' }))
    expect(res.status).toBe(503)
  })
})

describe('POST /api/well - a wish becomes a slop', () => {
  it('returns 200 with a slop response and persists author + wisher + wish + remark', async () => {
    const agentId = 'agent:test-spirit'
    await seatOnlyMockGenerator(agentId)

    const res = await action(actionArgs({ body: VALID_BODY, contentType: 'application/json' }))
    expect(res.status).toBe(200)

    const json = (await res.json()) as { kind: string; postId: string }
    // The OPEN contract's v1 arm: a slop, with the permalink target.
    expect(json.kind).toBe('slop')
    expect(typeof json.postId).toBe('string')
    expect(json.postId.length).toBeGreaterThan(0)

    // [LAW:behavior-not-structure] Read back through the public reader: the slop is
    // AUTHORED by the seated persona, the human is a `wisher` MODIFIER (never the
    // author), and the wish is persisted verbatim beside the machine prompt.
    const post = await getPostById(env, PostId(json.postId))
    expect(post).not.toBeNull()
    if (post === null) throw new Error('expected the slop to be readable')

    expect(post.origin.kind).toBe('authored')
    if (post.origin.kind !== 'authored') throw new Error('expected an authored origin')
    expect(post.origin.author.kind).toBe('agent')
    expect(post.origin.author.agentId).toBe(agentId)
    expect(post.origin.human).toEqual(
      expect.objectContaining({ role: 'wisher', by: expect.objectContaining({ kind: 'anon' }) }),
    )

    expect(post.content.kind).toBe('generation')
    if (post.content.kind !== 'generation') throw new Error('expected a generation')
    expect(post.content.render.wish).toBe('a lighthouse at the end of the world')

    // The signed remark (foundation.7) is persisted once, as a voice-layer Utterance.
    const [genRow] = await db(env)
      .select({ remarkJson: generations.remarkJson })
      .from(generations)
      .where(eq(generations.postId, PostId(json.postId)))
    expect(genRow).toBeDefined()
    expect(genRow!.remarkJson).not.toBeNull()
    const remark = JSON.parse(genRow!.remarkJson!) as { kind: string; text?: string }
    expect(remark.kind).toBe('spoke')
    expect(remark.text).toContain('a lighthouse at the end of the world')
  })

  it('sets the voter cookie when none was sent', async () => {
    await seatOnlyMockGenerator('agent:test-spirit-2')
    const res = await action(actionArgs({ body: VALID_BODY, contentType: 'application/json' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('slopspot_voter=')
  })
})
