import type { Route } from "./+types/api.posts.$id.vote"
import { z } from "zod"
import { setVote } from "~/db/votes"
import { resolveVoter } from "~/lib/voter-cookie"
import { PostId } from "~/lib/domain"

// [LAW:single-enforcer] The HTTP trust boundary for votes. Verification order:
// method check → same-origin check (CSRF gate) → body parse (Zod,
// [LAW:types-are-the-program] the wire shape already encodes the closed
// VoteIntent union, so a body with value=2 fails here before any DB touch) →
// voter id resolve → delegate to setVote.
//
// [LAW:locality-or-seam] Authentication is intentionally absent: voter identity
// is a long-lived anonymous cookie. Real auth (the prerequisite for users
// claiming votes across devices, or for blocking sock-puppet farms) is a
// separate epic; this surface is shaped to absorb that change later without
// rewriting the writer — the cookie helper is the swap point.

const bodySchema = z.object({
  value: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
})

// [LAW:single-enforcer] Same-origin gate for the state-changing POST. Browsers
// attach `Origin` on every POST submission they originate; a request whose
// Origin is present but doesn't match the request's own host is by definition
// cross-site (a third-party page driving the user's browser) and must be
// rejected before any voter id is minted. The SameSite=Lax cookie blocks the
// caller's existing identity from being sent — but resolveVoter would still
// mint a *fresh* one per call, letting a third party trickle the score under
// a stream of anonymous identities. The Origin check is what stops that.
//
// [LAW:no-defensive-null-guards] exception: an absent `Origin` header is a
// legitimate not-third-party case (some same-origin tooling and older clients
// omit it). Treat absent as same-origin and let the cookie/SameSite layer be
// the secondary defense. The defensive shape would be "reject if Origin is
// absent" — which would break legitimate clients without preventing the
// browser-driven attack the gate exists to block.
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (origin === null) return true
  // `Origin: null` (literal string) is what browsers send from sandboxed
  // iframes / opaque origins (RFC 6454). `new URL("null")` throws — so a
  // try/catch is the discriminator: any parse failure is treated as
  // "definitely not our origin." Fail closed; the gate exists to reject the
  // untrusted case, and an unparseable origin is untrusted by definition.
  try {
    // [LAW:types-are-the-program] `.origin` is the canonical RFC 6454 tuple —
    // scheme + host + port — not just host. Comparing `.host` would treat
    // `http://example.com` as same-origin as `https://example.com`, which
    // breaks the CSRF gate's whole premise (an http:// page should not be
    // able to drive POSTs against the https:// production deploy).
    return new URL(origin).origin === new URL(request.url).origin
  } catch {
    return false
  }
}

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
  if (voter.setCookieHeader !== null) {
    headers.set("set-cookie", voter.setCookieHeader)
  }
  return new Response(
    JSON.stringify({ score: result.score, value: result.value }),
    { headers },
  )
}
