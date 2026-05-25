import type { Route } from "./+types/api.posts.$id.vote"
import { z } from "zod"
import { setVote } from "~/db/votes"
import { resolveVoter } from "~/lib/voter-cookie"
import { PostId } from "~/lib/domain"

// [LAW:single-enforcer] The HTTP trust boundary for votes. Verification order:
// method check → body parse (Zod, [LAW:types-are-the-program] the wire shape
// already encodes the closed VoteIntent union, so a body with value=2 fails
// here before any DB touch) → voter id resolve → delegate to setVote.
//
// [LAW:locality-or-seam] Authentication is intentionally absent: voter identity
// is a long-lived anonymous cookie. Real auth (the prerequisite for users
// claiming votes across devices, or for blocking sock-puppet farms) is a
// separate epic; this surface is shaped to absorb that change later without
// rewriting the writer — the cookie helper is the swap point.

const bodySchema = z.object({
  value: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
})

export async function action({ request, params, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 })
  }

  let parsed
  try {
    parsed = bodySchema.parse(await request.json())
  } catch (e) {
    return Response.json(
      { error: "invalid body", detail: String(e), hint: "body must be { value: 1 | -1 | 0 } — 0 retracts" },
      { status: 400 },
    )
  }

  const voter = resolveVoter(request)

  const result = await setVote(
    {
      postId: PostId(params.id),
      voterId: voter.voterId,
      value: parsed.value,
    },
    { env: context.cloudflare.env },
  )

  const headers = new Headers({ "content-type": "application/json" })
  if (voter.setCookieHeader !== null) {
    headers.set("set-cookie", voter.setCookieHeader)
  }
  return new Response(JSON.stringify(result), { headers })
}
