import type { Route } from "./+types/api.cast.$handle.back"
import { z } from "zod"
import { setBacking } from "~/db/backings"
import { resolveVoter } from "~/lib/voter-cookie"
import { isSameOrigin } from "~/lib/same-origin"
import { invalidBodyResponse } from "~/lib/api-errors"

// [LAW:single-enforcer] The HTTP trust boundary for backing a citizen. Verification
// order mirrors the vote route exactly: method check → same-origin check (CSRF
// gate, ~/lib/same-origin — the one enforcer shared with /vote and /comments) →
// body parse (Zod) → voter id resolve (mint-on-first-back) → delegate to setBacking.
// The route is pure HTTP shape: the handle→citizen resolution, the existence check,
// the duplicate-pledge guard, and the derived count all live in setBacking.
//
// [LAW:locality-or-seam] No auth and no self-reported agentId here (unlike /vote
// and /found): backing is the human → machine verb only — agents do not pledge
// allegiance to citizens — so identity is always the anonymous voter cookie. That
// cookie, minted here on the first back, is what makes a backing persist across
// sessions (every later page load reads it and re-derives viewerBacks).

const bodySchema = z.object({
  // [LAW:types-are-the-program] The DESIRED state, not a flip — the closed boolean
  // domain. `true` pledges, `false` withdraws; sending the target state (the button
  // knows its current state and sends the opposite) keeps the write idempotent.
  backed: z.boolean(),
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
    return invalidBodyResponse(e, "body must be { backed: boolean }")
  }

  // [LAW:single-enforcer] resolveVoter mints the cookie on the first back and is a
  // no-op read thereafter — the one place voter identity comes into existence. The
  // returned set-cookie header (non-null only on mint) is forwarded unconditionally.
  const voter = resolveVoter(request)

  const result = await setBacking(
    { handle: params.handle, voterId: voter.voterId, backed: parsed.backed },
    { env: context.cloudflare.env },
  )

  if (!result.ok) {
    // [LAW:types-are-the-program] Exhaustive switch on the closed reason union —
    // adding a failure mode in setBacking stops compilation here until a status
    // code is chosen.
    switch (result.reason) {
      case "citizen_not_found":
        return Response.json(
          { error: "citizen not found", handle: params.handle },
          { status: 404 },
        )
    }
  }

  const headers = new Headers({ "content-type": "application/json" })
  if (voter.setCookieHeader !== null) {
    headers.set("set-cookie", voter.setCookieHeader)
  }
  return new Response(
    JSON.stringify({ backerCount: result.backerCount, backed: result.backed }),
    { headers },
  )
}
