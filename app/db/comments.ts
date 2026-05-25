// [LAW:single-enforcer] The one place a comment row is written or read. Every
// writer that touches the comments table — the /api/posts/:id/comments route,
// any future moderation tooling, any future agent-driven commenter — funnels
// through `createComment`. Reads funnel through `listComments`. The cookie
// boundary (resolveVoter / readVoterId) supplies authorId; this module never
// mints identities.
//
// [LAW:types-are-the-program] createComment returns a discriminated outcome,
// mirroring setVote — ok carries the inserted Comment, post_not_found carries
// the reason. The route's HTTP mapping is an exhaustive switch on the closed
// union (200 / 404). Adding a new failure arm stops compilation at the route
// until a status code is chosen.

import { desc, eq } from 'drizzle-orm'
import { db } from '~/db/client'
import { comments } from '~/db/schema'
import { posts } from '~/db/schema'
import { CommentId, PostId, type Comment } from '~/lib/domain'

export type CreateCommentInput = {
  postId: PostId
  authorId: string
  body: string
}

export type CreateCommentResult =
  | { ok: true; comment: Comment }
  | { ok: false; reason: 'post_not_found' }

// [LAW:dataflow-not-control-flow] Same shape every call: confirm the post
// exists, then insert, then return the inserted row reified into the Comment
// domain shape. The post-existence pre-check mirrors setVote — symmetric across
// every comments writer rather than catching a per-driver FK error at one site.
//
// [LAW:types-are-the-program] The id is minted here, not by the caller. The
// HTTP boundary supplies (postId, authorId, body); the writer is the canonical
// source of comment identity. crypto.randomUUID is RFC-4122; the PK column is
// opaque TEXT, so the shape doesn't need to be validated elsewhere.
export async function createComment(
  input: CreateCommentInput,
  ctx: { env: Env },
): Promise<CreateCommentResult> {
  const { postId, authorId, body } = input
  const database = db(ctx.env)

  const exists = await database
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1)
  if (exists.length === 0) {
    return { ok: false, reason: 'post_not_found' }
  }

  const id = CommentId(crypto.randomUUID())
  const createdAt = new Date()
  await database.insert(comments).values({
    id,
    postId,
    authorId,
    body,
    createdAt,
  })

  return {
    ok: true,
    comment: { id, postId, authorId, body, createdAt },
  }
}

// [LAW:single-enforcer] The one read path for a post's thread. Newest-first is
// the canonical order for the v1 flat feed (the index on (post_id, created_at)
// serves this query directly — see schema.ts). Returns domain Comments, not raw
// rows, so callers never re-shape at the boundary.
export async function listComments(env: Env, postId: PostId): Promise<Comment[]> {
  const database = db(env)
  const rows = await database
    .select()
    .from(comments)
    .where(eq(comments.postId, postId))
    .orderBy(desc(comments.createdAt))

  return rows.map((row) => ({
    id: CommentId(row.id),
    postId: PostId(row.postId),
    authorId: row.authorId,
    body: row.body,
    createdAt: row.createdAt,
  }))
}
