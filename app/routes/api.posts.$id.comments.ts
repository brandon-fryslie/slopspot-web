import type { Route } from "./+types/api.posts.$id.comments"
import { z } from "zod"
import { createComment, listComments } from "~/db/comments"
import { resolveVoter } from "~/lib/voter-cookie"
import { isSameOrigin } from "~/lib/same-origin"
import { invalidBodyResponse } from "~/lib/api-errors"
import { PostId } from "~/lib/domain"

// [LAW:single-enforcer] The HTTP trust boundary for comments. Verification
// order on POST: method check → same-origin gate (shared with the vote route
// via ~/lib/same-origin) → body parse (Zod: trim + 1..2000) → voter id resolve
// → delegate to createComment.
//
// [LAW:locality-or-seam] GET is the dual: no body, no Origin gate (reads are
// not state-changing CSRF targets), no cookie mint (reads cannot create
// identity — that is resolveVoter's job at write time). The two verbs share
// one route file because they share the same (postId) parameter and the same
// resource; they share nothing else.

// [LAW:types-are-the-program] The wire shape enforces non-empty, trimmed body
// within the 1..2000 grapheme bound. `.trim()` is a transform — it normalizes
// before length is evaluated, so a whitespace-only body fails the min(1) by
// construction rather than slipping through to a stored row of empty text.
const bodySchema = z.object({
  body: z.string().trim().min(1).max(2000),
})

export async function action({ request, params, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 })
  }

  if (!isSameOrigin(request)) {
    return Response.json({ error: "cross-origin POST forbidden" }, { status: 403 })
  }

  let parsed
  try {
    parsed = bodySchema.parse(await request.json())
  } catch (e) {
    return invalidBodyResponse(e, "body must be { body: string } where body is 1..2000 chars after trim")
  }

  const voter = resolveVoter(request)

  const result = await createComment(
    {
      postId: PostId(params.id),
      authorId: voter.voterId,
      body: parsed.body,
    },
    { env: context.cloudflare.env },
  )

  if (!result.ok) {
    // [LAW:types-are-the-program] Exhaustive switch on the closed reason
    // union — adding a new failure mode in createComment stops compilation
    // here until a status code is chosen.
    switch (result.reason) {
      case "post_not_found":
        return Response.json({ error: "post not found", postId: params.id }, { status: 404 })
    }
  }

  const headers = new Headers({ "content-type": "application/json" })
  if (voter.setCookieHeader !== null) {
    headers.set("set-cookie", voter.setCookieHeader)
  }
  return new Response(
    JSON.stringify({
      id: result.comment.id,
      authorId: result.comment.authorId,
      body: result.comment.body,
      createdAt: result.comment.createdAt.toISOString(),
    }),
    { headers, status: 201 },
  )
}

// [LAW:dataflow-not-control-flow] Same shape every call: list, serialize,
// return. No "if there are no comments, special-case" — the empty list is the
// data. Times serialize as ISO strings on the wire; the client parses them
// back to Date at the UI boundary.
export async function loader({ params, context }: Route.LoaderArgs) {
  const list = await listComments(
    context.cloudflare.env,
    PostId(params.id),
  )
  return Response.json({
    comments: list.map((c) => ({
      id: c.id,
      authorId: c.authorId,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
  })
}
