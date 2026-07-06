// [LAW:behavior-not-structure] Pins /api/posts/:id/comments' *contract* — the
// status-code map and the wire shape of the thread. The epic's bar
// (slopspot-post-comments-8q9.1): the API returns ONE comment shape suitable
// for uniform rendering; author origin is a data fact that stays server-side,
// so the wire carries a plain `authorLabel` string for BOTH visitor- and
// citizen-authored rows and never leaks a kind/origin discriminator or a raw
// identity.
//
// [LAW:types-are-the-program] Runs against real D1 (workers project) so the
// createComment → row → listComments → serialization round-trip is exercised
// by real SQL, not mocks.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { action, loader } from '~/routes/api.posts.$id.comments'
import { seedComment, seedPost } from '~/db/__tests__/helpers'

const stubCtx: ExecutionContext = {
  waitUntil() {},
  passThroughOnException() {},
  exports: {} as Cloudflare.Exports,
  props: {},
}

function routeArgs(init: {
  postId: string
  method?: string
  body?: string
  cookie?: string
}) {
  const url = new URL(`https://slopspot.ai/api/posts/${init.postId}/comments`)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (init.cookie !== undefined) headers['cookie'] = init.cookie
  return {
    params: { id: init.postId },
    context: { cloudflare: { env, ctx: stubCtx } },
    request: new Request(url, {
      method: init.method ?? 'GET',
      body: init.body,
      headers,
    }),
    url,
    pattern: '/api/posts/:id/comments',
  }
}

async function seedPersona(agentId: string, displayName: string) {
  await env.DB.prepare(
    "INSERT INTO personas (agent_id, handle, display_name, role, persona_prompt, model_id, config_json, created_at) VALUES (?, NULL, ?, 'voter', 'p', 'm', '{}', 1)",
  )
    .bind(agentId, displayName)
    .run()
}

describe('POST /api/posts/:id/comments', () => {
  it('creates a visitor comment and returns the uniform wire shape, label redacted', async () => {
    const postId = await seedPost(env)
    const res = (await action(
      routeArgs({
        postId,
        method: 'POST',
        body: JSON.stringify({ body: 'a visitor comment' }),
      }) as Parameters<typeof action>[0],
    )) as Response

    expect(res.status).toBe(201)
    const json = (await res.json()) as Record<string, unknown>
    expect(Object.keys(json).sort()).toEqual(['authorLabel', 'body', 'createdAt', 'id'])
    expect(json.authorLabel).toMatch(/^anon-[0-9a-f]{6}$/)
    expect(json.body).toBe('a visitor comment')
  })
})

describe('GET /api/posts/:id/comments', () => {
  it('serves a mixed thread as ONE shape: no origin discriminator, no raw identity on the wire', async () => {
    const postId = await seedPost(env)
    await seedPersona('a:gutter', 'GutterMonk')
    await seedComment(env, {
      postId,
      authorId: 'f3d9aa77-visitor-uuid',
      body: 'visitor speaks',
      createdAt: new Date('2026-01-01T00:00:01Z'),
    })
    await seedComment(env, {
      postId,
      authorId: 'a:gutter',
      authorKind: 'agent',
      body: 'the monk answers',
      createdAt: new Date('2026-01-01T00:00:02Z'),
    })

    const res = (await loader(
      routeArgs({ postId }) as Parameters<typeof loader>[0],
    )) as Response
    expect(res.status).toBe(200)
    const json = (await res.json()) as { comments: Record<string, unknown>[] }

    expect(json.comments).toHaveLength(2)
    for (const c of json.comments) {
      // [LAW:one-type-per-behavior] Uniform serialization: every row, either
      // author arm, is exactly this shape — a renderer cannot branch on origin
      // because origin is not on the wire.
      expect(Object.keys(c).sort()).toEqual(['authorLabel', 'body', 'createdAt', 'id'])
    }
    // Citizen rows read as their persona's name; visitor rows as the redacted anon label.
    expect(json.comments[0].authorLabel).toBe('GutterMonk')
    expect(json.comments[1].authorLabel).toBe('anon-f3d9aa')
    // The full visitor UUID never crosses the wire.
    expect(JSON.stringify(json)).not.toContain('f3d9aa77-visitor-uuid')
  })
})
