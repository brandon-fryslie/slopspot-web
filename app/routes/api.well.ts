import type { Route } from "./+types/api.well"
import { z } from "zod"
import { ApiError } from "@fal-ai/client"
import { authorSlop } from "~/agents/generator"
import { seatCitizen } from "~/agents/seating"
import { InvalidParamsError } from "~/db/posts"
import { checkBudget } from "~/firehose/budget"
import { UnknownProviderError } from "~/providers"
import { resolveVoter } from "~/lib/voter-cookie"
import { isSameOrigin } from "~/lib/same-origin"
import { invalidBodyResponse } from "~/lib/api-errors"
import { authorLabel } from "~/lib/author-label"
import { slopResponse, WISH_MAX, type WellResponse } from "~/lib/well-response"
import { WELL_REACHABLE } from "~/lib/well-gate"

// [LAW:single-enforcer] The HTTP trust boundary for the Wishing Well — the haunted
// prompt box (foundation.8, design-docs/the-wishing-well.md). A visitor's WISH is
// submitted to "the assigned spirit," which re-authors it into a slop. The box is
// the séance; this is the one channel it speaks through.
//
// [LAW:dataflow-not-control-flow] ONE channel, no mode toggle. The contract's
// response is polymorphic (WellResponse: slop | reply); v1 builds only the `slop`
// arm. The reply arm (talk-back, Acts IV–V) is reserved in the type, never
// constructed here — see ~/lib/well-response.ts. There is no content-discrimination
// in v1: every wish yields a slop. When the spirit learns to tell a wish from an
// address, that discriminator slots in HERE without changing the channel or the box.
//
// Verification order: method → isSameOrigin (CSRF, shared with /vote, /comments,
// /fork, /found) → body parse (Zod) → budget gate (a real provider fires) → voter id
// resolve → seatCitizen (the house assigns the spirit; null = no active citizen, a
// real terminal state) → authorSlop with the wish + wisher modifier.
//
// CSRF: cookie-auth POST → isSameOrigin, like the other cookie-auth writers.
// /api/generate uses the challenge gate instead; the Well is human-facing, so it
// uses the same-origin model the human-facing writers share.
//
// PRODUCT INVARIANT: the box takes a WISH, never an editable prompt. The wish is
// re-authored by the spirit and NEVER sent raw to the provider (composer.ts isolates
// it); the reveal DAWNS on the slop's card — this endpoint discloses nothing.

const bodySchema = z.object({
  // The visitor's wish. Trimmed at this boundary (outer whitespace is input hygiene,
  // not intent — and the trim is what makes a whitespace-only wish reject) then
  // 1..WISH_MAX. "Verbatim" here means the spirit never REWRITES the wish into the
  // prompt and it is never sent raw to the provider (composer.ts owns that
  // isolation) — not that surrounding whitespace is preserved byte-for-byte.
  wish: z.string().trim().min(1).max(WISH_MAX),
})

export async function action({ request, context }: Route.ActionArgs) {
  // [LAW:single-enforcer] The Well is gated until its soul is verified (well-gate.ts).
  // While gated the channel does not exist — a 404, not a disabled 403: there is no
  // partial Well, and an authored slop here would be the literal-echo the gate forbids.
  // [LAW:no-silent-failure] the gate is the first thing checked, before any side effect.
  if (!WELL_REACHABLE) {
    return Response.json({ error: "not found" }, { status: 404 })
  }

  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 })
  }

  // [LAW:single-enforcer] Same-origin gate shared with /vote, /comments, /fork,
  // /found — a cookie-auth POST without an Origin check is a CSRF target.
  if (!isSameOrigin(request)) {
    return Response.json({ error: "cross-origin POST forbidden" }, { status: 403 })
  }

  let parsed
  try {
    parsed = bodySchema.parse(await request.json())
  } catch (e) {
    return invalidBodyResponse(
      e,
      `body must be { wish: string (1..${WISH_MAX} after trim) }`,
    )
  }

  // [LAW:single-enforcer] The same daily spend cap /api/generate and /fork honor —
  // answering a wish fires a real provider. Gated before seating so a wish made
  // while over budget never seats a spirit it can't pay for.
  let budget
  try {
    budget = await checkBudget(context.cloudflare.env)
  } catch {
    return Response.json({ error: "budget check unavailable" }, { status: 503 })
  }
  if (!budget.withinBudget) {
    return Response.json(
      {
        error: "daily budget exhausted",
        spentUsd: budget.spentUsd,
        ceilingUsd: budget.ceilingUsd,
      },
      { status: 429 },
    )
  }

  const voter = resolveVoter(request)

  // [LAW:single-enforcer] seatCitizen is the ONE place the wish-answerer is chosen
  // (app/agents/seating.ts, foundation.5) — we do not re-pick the persona. A null
  // return is a real terminal state (the city has no active citizen to answer),
  // surfaced as 503, never a defensive skip. [LAW:no-defensive-null-guards]
  const seated = await seatCitizen(context.cloudflare.env, { text: parsed.wish })
  if (seated === null) {
    return Response.json(
      { error: "no spirit is keeping the well tonight" },
      { status: 503 },
    )
  }

  try {
    // [LAW:single-enforcer] authorSlop is the one authoring path (shared with the
    // firehose). The occasion carries the wish + the human wisher (an anon-cookie
    // MODIFIER, never the author). authorLabel is the single voter-UUID → anon-XXXXXX
    // redactor, identical to the breeder/finder bylines. Date.now() is the chooser's
    // recipe RNG seed — a live request has no scheduled time.
    const post = await authorSlop(
      context.cloudflare.env,
      seated,
      Date.now(),
      { kind: "wish", wish: parsed.wish, wisher: { kind: "anon", label: authorLabel(voter.voterId) } },
    )

    // [LAW:dataflow-not-control-flow] The box's response is the polymorphic
    // WellResponse; v1 always returns the `slop` arm. The client discriminates on
    // `kind`, so the success status is arm-agnostic (200) — the future `reply` arm
    // returns the same status, no refactor. (This intentionally differs from /fork
    // and /found's 201: the Well is a polymorphic box, not a CRUD create endpoint.)
    const body: WellResponse = slopResponse(post.id)
    const headers = new Headers({ "content-type": "application/json" })
    if (voter.setCookieHeader !== null) {
      headers.set("set-cookie", voter.setCookieHeader)
    }
    return new Response(JSON.stringify(body), { headers, status: 200 })
  } catch (e) {
    // [LAW:errors] The provider is the SEATED persona's medium — server-owned config,
    // not a client choice — so a misconfigured medium (UnknownProviderError) or
    // bad-params (InvalidParamsError) is OUR fault → 500, not a 4xx blamed on the
    // wisher. An upstream provider failure (ApiError / anything else) → 502.
    if (e instanceof UnknownProviderError || e instanceof InvalidParamsError) {
      // Pass the error as a SEPARATE console arg, not an object field: Error's own
      // properties are non-enumerable, so `{ err: e }` drops the stack in Workers logs.
      console.error("api.well: spirit misconfigured", { agentId: seated.agentId }, e)
      return Response.json({ error: "the spirit could not be roused" }, { status: 500 })
    }
    const upstreamStatus = e instanceof ApiError ? e.status : undefined
    console.error("api.well: the spirit faltered", { agentId: seated.agentId }, e)
    return Response.json(
      {
        error: "the spirit faltered",
        ...(upstreamStatus !== undefined ? { upstreamStatus } : {}),
      },
      { status: 502 },
    )
  }
}
