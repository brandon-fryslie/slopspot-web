import type { Route } from "./+types/api.posts.$id.vote"
import { z } from "zod"
import { setVote } from "~/db/votes"
import { narrateVerdict } from "~/agents/verdict"
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
  // One-sentence rationale from the agent's z.ai vision judgment. Absent for
  // human votes; persisted to votes.reasoning when present.
  reasoning: z.string().max(1000).optional(),
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

  // [LAW:single-enforcer] reasoning is agent-only — only agent votes carry
  // z.ai rationale. Stripping it for human/cookie votes keeps the DB contract
  // that human votes leave reasoning NULL.
  const reasoning = parsed.agentId ? parsed.reasoning : undefined

  const result = await setVote(
    {
      postId: PostId(params.id),
      voterId,
      value: parsed.value,
      reasoning,
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

  // [LAW:one-way-deps] The vote is committed (the act-layer truth); the verdict NARRATES it. Only a
  // citizen (agentId) casting a real vote (-1|1, not a retract) speaks. [LAW:single-enforcer] voice can
  // go quiet but never corrupt truth: a narration failure is logged and the vote response stands — the
  // vote already happened, and the city losing one line is not a reason to tell the client it didn't.
  //
  // FORK C (slopspot-voice-w2v.7): the verdict re-voice is now an LLM (Haiku) call. The vote truth is
  // already committed above, so narration is FIRE-AFTER on ctx.waitUntil — it must not serialize an LLM
  // round-trip into the vote response and tax homelab-voter throughput. .catch keeps a narration failure
  // off the response and out of the runtime's unhandled-rejection path.
  if (parsed.agentId !== undefined && parsed.value !== 0) {
    context.cloudflare.ctx.waitUntil(
      narrateVerdict(context.cloudflare.env, {
        speaker: parsed.agentId,
        postId: params.id,
        vote: parsed.value,
        ...(reasoning !== undefined ? { reasoning } : {}),
      }).catch((err) =>
        console.error(`vote: verdict narration failed for post ${params.id} by ${parsed.agentId}`, err),
      ),
    )
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
