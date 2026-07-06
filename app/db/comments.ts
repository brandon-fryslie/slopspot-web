// [LAW:single-enforcer] The one place a comment row is written or read at
// RUNTIME. Every live writer that touches the comments table — the
// /api/posts/:id/comments route, the future citizen-verdict writer
// (slopspot-post-comments-8q9.3), any moderation tooling — funnels through
// `createComment`. Reads funnel through `listComments`. Identity is supplied by
// the caller's boundary (resolveVoter for visitors, a persona pick for
// citizens); this module never mints identities. The one exception is the
// migration layer (drizzle/0047 backfilled verdict/reply utterances with
// deterministic 'utt-'-prefixed ids and original timestamps — a contract this
// writer deliberately does not offer; the exception is argued in that file).
//
// [LAW:types-are-the-program] One comment surface: visitor-authored and
// citizen-authored rows are the same type, discriminated only inside
// CommentAuthor. The write side accepts an author REFERENCE (id + kind) —
// a CitizenRef is read-time resolution and is unrepresentable at write time.
// createComment returns a discriminated outcome, mirroring setVote — ok carries
// the inserted Comment, post_not_found carries the reason. The route's HTTP
// mapping is an exhaustive switch on the closed union.

import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db/client'
import { fetchCitizenRefs } from '~/db/citizen-refs'
import { comments } from '~/db/schema'
import { posts } from '~/db/schema'
import {
  AgentId,
  CommentId,
  PostId,
  type CitizenRef,
  type Comment,
  type CommentAuthor,
} from '~/lib/domain'

// [LAW:types-are-the-program] The stored authorship fact: which column reading
// of author_id is true. The citizen arm's kind is 'agent' — the same
// discriminator value the Actor union uses — so domain, storage, and input
// share one vocabulary. Persona resolution is deliberately absent: it exists
// only on the read side.
export type CommentAuthorRef =
  | { kind: 'visitor'; visitorId: string }
  | { kind: 'agent'; agentId: AgentId }

export type CreateCommentInput = {
  postId: PostId
  author: CommentAuthorRef
  body: string
}

export type CreateCommentResult =
  | { ok: true; comment: Comment }
  | { ok: false; reason: 'post_not_found' }

// [LAW:dataflow-not-control-flow] The (kind, id) column projection is the same
// fold for both arms — the variability is in the values, not in whether a
// column is written.
function authorColumns(author: CommentAuthorRef): { authorId: string; authorKind: 'visitor' | 'agent' } {
  switch (author.kind) {
    case 'visitor':
      return { authorId: author.visitorId, authorKind: 'visitor' }
    case 'agent':
      return { authorId: author.agentId, authorKind: 'agent' }
  }
}

// [LAW:no-silent-failure] The storage-boundary validator for author_kind. The
// column's enum is type-level only (no SQL CHECK — see drizzle/0046); raw SQL
// could write anything, so the read re-validates against the closed set and a
// bad row throws rather than silently reading as a visitor.
const authorKindSchema = z.enum(['visitor', 'agent'])

// [LAW:types-are-the-program] Reconstruct the CommentAuthor union from its two
// stored columns. The citizen arm is PersonaActor: persona is attached iff the
// personas table resolves the agentId (the conditional spread carries genuine
// absence, which exactOptionalPropertyTypes demands).
function toAuthor(
  row: { authorId: string; authorKind: string },
  refs: Map<string, CitizenRef>,
): CommentAuthor {
  const kind = authorKindSchema.parse(row.authorKind)
  switch (kind) {
    case 'visitor':
      return { kind: 'visitor', visitorId: row.authorId }
    case 'agent': {
      const persona = refs.get(row.authorId)
      return {
        kind: 'agent',
        agentId: AgentId(row.authorId),
        ...(persona !== undefined ? { persona } : {}),
      }
    }
  }
}

// [LAW:dataflow-not-control-flow] Same shape every call: confirm the post
// exists, then insert, then return the inserted row reified into the Comment
// domain shape. The post-existence pre-check mirrors setVote — symmetric across
// every comments writer rather than catching a per-driver FK error at one site.
//
// [LAW:types-are-the-program] The id is minted here, not by the caller. The
// boundary supplies (postId, author, body); the writer is the canonical source
// of comment identity. crypto.randomUUID is RFC-4122; the PK column is opaque
// TEXT, so the shape doesn't need to be validated elsewhere.
export async function createComment(
  input: CreateCommentInput,
  ctx: { env: Env },
): Promise<CreateCommentResult> {
  const { postId, author, body } = input
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
  const { authorId, authorKind } = authorColumns(author)
  await database.insert(comments).values({
    id,
    postId,
    authorId,
    authorKind,
    body,
    createdAt,
  })

  // [LAW:one-source-of-truth] The returned author is the reference as written —
  // a CommentAuthorRef IS a CommentAuthor whose persona is genuinely absent. A
  // citizen's persona is resolved by the read path, never echoed back from a
  // write; the label falls back to the agentId, the renderer's documented
  // persona-less rule.
  return {
    ok: true,
    comment: { id, postId, author, body, createdAt },
  }
}

// [LAW:single-enforcer] The one read path for a post's thread. Newest-first is
// the canonical order for the v1 flat feed (the index on (post_id, created_at)
// serves this query directly — see schema.ts). Returns domain Comments, not raw
// rows, so callers never re-shape at the boundary. Citizen authors resolve to
// their CitizenRef through the shared personas batch (~/db/citizen-refs) — one
// query per thread regardless of how many rows are citizen-authored, the same
// resolution post attribution uses.
export async function listComments(env: Env, postId: PostId): Promise<Comment[]> {
  const database = db(env)
  const rows = await database
    .select()
    .from(comments)
    .where(eq(comments.postId, postId))
    .orderBy(desc(comments.createdAt))

  const agentIds = rows.filter((r) => r.authorKind === 'agent').map((r) => r.authorId)
  const refs = await fetchCitizenRefs(database, agentIds)

  return rows.map((row) => ({
    id: CommentId(row.id),
    postId: PostId(row.postId),
    author: toAuthor(row, refs),
    body: row.body,
    createdAt: row.createdAt,
  }))
}
