import type { Route } from "./+types/api.posts.$id.vote"
import { z } from "zod"
import { setVote } from "~/db/votes"
import { resolveVoter } from "~/lib/voter-cookie"
import { isSameOrigin } from "~/lib/same-origin"
import { invalidBodyResponse } from "~/lib/api-errors"
import { PostId } from "~/lib/domain"

// [LAW:single-enforcer] The HTTP trust boundary for votes. Verification order:
// method check → same-origin check (CSRF gate, ~/lib/same-origin — one enforcer
// shared with /api/posts/:id/comments) → body parse (Zod,
// [LAW:types-are-the-program] the wire shape already encodes the closed
// VoteIntent union, so a body with value=2 fails here before any DB touch) →
// voter id resolve → delegate to setVote.
//
// [LAW:locality-or-seam] Authentication is intentionally absent: voter identity
// is a long-lived anonymous cookie for humans and a self-reported agentId for
// homelab agents (same attribution-only model as /api/found — not an auth claim).
// Real auth is a later epic.

const bodySchema = z.object({
  value: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
  // [LAW:single-enforcer] agentId is self-reported attribution metadata from
  // homelab voter agents. When present it overrides the cookie identity —
  // attribution only, not an auth claim (same pattern as /api/found).
  agentId: z.string().min(1).max(256).optional(),
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
    return invalidBodyResponse(e, "body must be { value: 1 | -1 | 0 } — 0 retracts")
  }

  // Agent votes use the self-reported agentId; human votes resolve from cookie.
  const voter = parsed.agentId ? null : resolveVoter(request)
  const voterId = parsed.agentId ?? voter!.voterId
  const setCookieHeader = voter?.setCookieHeader ?? null

  const result = await setVote(
    {
      postId: PostId(params.id),
      voterId,
      value: parsed.value,
    },
    { env: context.cloudflare.env },
  )

  if (!result.ok) {
    // [LAW:types-are-the-program] Exhaustive switch on the closed reason
    // union — adding a new failure mode in setVote stops compilation here
    // until a status code is chosen.
    switch (result.reason) {
      case "post_not_found":
        return Response.json({ error: "post not found", postId: params.id }, { status: 404 })
    }
  }

  const headers = new Headers({ "content-type": "application/json" })
  if (setCookieHeader !== null) {
    headers.set("set-cookie", setCookieHeader)
  }
  return new Response(
    JSON.stringify({ score: result.score, value: result.value }),
    { headers },
  )
}
