// [LAW:behavior-not-structure] Pins the comments contract for the one mixed
// thread (slopspot-post-comments-8q9.1): visitor comments round-trip unchanged,
// citizen-authored rows are representable through the same surface, the read
// path returns ONE comment shape whose author resolves through the same persona
// machinery post attribution uses, and the label boundary is uniform — a plain
// string for both arms, so rendering never branches on origin. The origin
// discriminator appears ONLY inside `author`; these tests assert the wire/label
// surface does not leak it.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { createComment, listComments } from '~/db/comments'
import { commentAuthorLabel } from '~/lib/author-label'
import { AgentId, PostId } from '~/lib/domain'
import { seedComment, seedPost } from './helpers'

async function seedPersona(agentId: string, displayName: string) {
  await env.DB.prepare(
    "INSERT INTO personas (agent_id, handle, display_name, role, persona_prompt, model_id, config_json, created_at) VALUES (?, NULL, ?, 'voter', 'p', 'm', '{}', 1)",
  )
    .bind(agentId, displayName)
    .run()
}

describe('createComment', () => {
  it('round-trips a visitor comment: full UUID in the domain, redacted label at the boundary', async () => {
    const postId = await seedPost(env)
    const visitorId = crypto.randomUUID()

    const result = await createComment(
      { postId, author: { kind: 'visitor', visitorId }, body: 'hello from a visitor' },
      { env },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.comment.author).toEqual({ kind: 'visitor', visitorId })

    const listed = await listComments(env, postId)
    expect(listed).toHaveLength(1)
    expect(listed[0].author).toEqual({ kind: 'visitor', visitorId })
    expect(listed[0].body).toBe('hello from a visitor')
    // The label redacts: anon- prefix + 6 chars, never the full UUID.
    expect(commentAuthorLabel(listed[0].author)).toBe(`anon-${visitorId.slice(0, 6)}`)
  })

  it('represents a citizen-authored comment through the same writer', async () => {
    const postId = await seedPost(env)
    const agentId = AgentId('a:critic')

    const result = await createComment(
      { postId, author: { kind: 'agent', agentId }, body: 'a verdict as a comment' },
      { env },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Write-side echo carries the reference only — persona is read-time.
    expect(result.comment.author).toEqual({ kind: 'agent', agentId })
  })

  it('returns post_not_found for a missing post, either author arm', async () => {
    const ghost = PostId('no-such-post')
    const visitor = await createComment(
      { postId: ghost, author: { kind: 'visitor', visitorId: 'v-1' }, body: 'x' },
      { env },
    )
    const citizen = await createComment(
      { postId: ghost, author: { kind: 'agent', agentId: AgentId('a:critic') }, body: 'x' },
      { env },
    )
    expect(visitor).toEqual({ ok: false, reason: 'post_not_found' })
    expect(citizen).toEqual({ ok: false, reason: 'post_not_found' })
  })
})

describe('listComments', () => {
  it('returns one mixed thread, newest-first, one shape for both author arms', async () => {
    const postId = await seedPost(env)
    await seedPersona('a:gutter', 'GutterMonk')
    await seedComment(env, {
      postId,
      authorId: 'visitor-uuid-1',
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

    const listed = await listComments(env, postId)
    expect(listed).toHaveLength(2)
    // Newest first; both rows are the SAME Comment shape.
    expect(listed[0].body).toBe('the monk answers')
    expect(listed[0].author).toEqual({
      kind: 'agent',
      agentId: 'a:gutter',
      persona: { handle: null, displayName: 'GutterMonk' },
    })
    expect(listed[1].author).toEqual({ kind: 'visitor', visitorId: 'visitor-uuid-1' })

    // [LAW:one-type-per-behavior] Uniform serialization surface: both arms fold
    // to a plain string label — the renderer never sees the discriminator.
    const labels = listed.map((c) => commentAuthorLabel(c.author))
    expect(labels).toEqual(['GutterMonk', 'anon-visito'])
  })

  it('falls back to the agentId label for a persona-less citizen', async () => {
    const postId = await seedPost(env)
    await seedComment(env, { postId, authorId: 'sys:slop-cron', authorKind: 'agent' })

    const listed = await listComments(env, postId)
    expect(listed[0].author).toEqual({ kind: 'agent', agentId: 'sys:slop-cron' })
    expect(commentAuthorLabel(listed[0].author)).toBe('sys:slop-cron')
  })

  it('fails loud on a stored author_kind outside the closed set', async () => {
    const postId = await seedPost(env)
    // Raw SQL can violate what the column's type-level enum cannot enforce;
    // the read boundary must throw, never silently read the row as a visitor.
    await env.DB.prepare(
      "INSERT INTO comments (id, post_id, author_id, author_kind, body, created_at) VALUES ('c-bad', ?, 'x', 'gremlin', 'b', 1)",
    )
      .bind(postId)
      .run()

    await expect(listComments(env, postId)).rejects.toThrow()
  })

  it('reads pre-migration rows (author_kind defaulted) as visitor comments', async () => {
    const postId = await seedPost(env)
    // Insert WITHOUT author_kind — the 0046 column default is the backfill.
    await env.DB.prepare(
      "INSERT INTO comments (id, post_id, author_id, body, created_at) VALUES ('c-old', ?, 'legacy-visitor-uuid', 'old comment', 1)",
    )
      .bind(postId)
      .run()

    const listed = await listComments(env, postId)
    expect(listed[0].author).toEqual({ kind: 'visitor', visitorId: 'legacy-visitor-uuid' })
  })
})
