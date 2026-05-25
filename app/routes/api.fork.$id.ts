import type { Route } from "./+types/api.fork.$id"
import { z } from "zod"
import { ApiError } from "@fal-ai/client"
import { createPost, InvalidParamsError } from "~/db/posts"
import { getPostById } from "~/db/feed"
import { checkBudget } from "~/firehose/budget"
import { getProvider, UnknownProviderError } from "~/providers"
import { resolveVoter } from "~/lib/voter-cookie"
import { isSameOrigin } from "~/lib/same-origin"
import { invalidBodyResponse } from "~/lib/api-errors"
import { authorLabel } from "~/lib/author-label"
import { AgentId, PostId, type Origin } from "~/lib/domain"
import { aspectRatioSchema, styleFamilySchema } from "~/lib/variety"

// [LAW:single-enforcer] The HTTP trust boundary for fork submission. Resource
// route (no default export) — matching /api/posts/:id/vote and
// /api/posts/:id/comments. The page route at /fork/:id renders the form and
// POSTs here; it never embeds an action of its own (RR7's document-route CSRF
// gate requires x-forwarded-host alignment that the vite-plugin dev server
// does not set, and the same-origin defense already lives at this boundary).
//
// Verification order: method → isSameOrigin (CSRF, ~/lib/same-origin shared
// with vote + comments) → body parse (Zod) → parent lookup → assert parent is
// a generation → budget gate → voter id resolve → derive provider-native
// params via provider.defaultParamsForRecipe → delegate to createPost with
// parentId set.

const PROMPT_MAX = 1000

const bodySchema = z.object({
  prompt: z.string().trim().min(1).max(PROMPT_MAX),
  styleFamily: styleFamilySchema,
  aspectRatio: aspectRatioSchema,
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
    return invalidBodyResponse(
      e,
      "body must be { prompt: string (1..1000 after trim), styleFamily, aspectRatio }",
    )
  }

  const parent = await getPostById(context.cloudflare.env, PostId(params.id))
  if (parent === null) {
    return Response.json(
      { error: "parent post not found", postId: params.id },
      { status: 404 },
    )
  }
  if (parent.content.kind !== "generation") {
    // [LAW:types-are-the-program] Uploads carry no recipe. The PostCard Fork
    // button is gated on content.kind at compile time; this 400 defends
    // direct-URL access.
    return Response.json(
      { error: "only generation posts are forkable", postId: params.id },
      { status: 400 },
    )
  }

  // [LAW:single-enforcer] Same daily spend cap the /api/generate route honors.
  // A successful fork calls a real provider — the budget gate must apply at
  // every paid entrypoint, not just the agent-API one. Runs after parent-
  // validity checks so a malformed fork (404 / 400) doesn't get to probe the
  // spend state.
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

  // [LAW:single-enforcer] Provider lookup happens here (and again inside
  // createPost) — both call the same registry, so the lookup is one source of
  // truth. The early call here is the seam where canonical recipe fields
  // (prompt, styleFamily, seed) become provider-native params via
  // defaultParamsForRecipe — the same translation the firehose chooser does.
  let provider
  try {
    provider = getProvider(parent.content.recipe.providerId)
  } catch (e) {
    if (e instanceof UnknownProviderError) {
      return Response.json(
        {
          error: "parent post's provider is no longer registered",
          providerId: parent.content.recipe.providerId,
        },
        { status: 404 },
      )
    }
    throw e
  }

  // Fresh seed each fork — reproducibility-by-default is the firehose's
  // contract, not the user-fork's. A user who wants to re-fork the same recipe
  // gets a new generation each time, which matches the UX intent.
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]
  const derivedParams = provider.defaultParamsForRecipe({
    prompt: parsed.prompt,
    styleFamily: parsed.styleFamily,
    seed,
  })

  const voter = resolveVoter(request)

  // [LAW:single-enforcer] Anonymous-forker attribution. The raw voter UUID
  // never crosses the wire (the home loader serializes Origin onto every page
  // render); authorLabel is the same redaction enforcer comments use, so the
  // wire shape of origin is the same `anon-XXXXXX` shape comments already
  // expose. [LAW:types-are-the-program] exception: representing an anonymous
  // viewer as `kind: 'agent'` is a domain-modeling concession; the actor
  // union has no `anon` variant today. Tracked for a follow-up that adds the
  // third Actor variant if/when human-vs-bot distinctions become visible in
  // the UI.
  const origin: Origin = {
    actor: {
      kind: "agent",
      agentId: AgentId(authorLabel(voter.voterId)),
    },
  }

  try {
    const post = await createPost(
      {
        providerId: parent.content.recipe.providerId,
        params: derivedParams,
        styleFamily: parsed.styleFamily,
        subject: parent.content.recipe.subject,
        aspectRatio: parsed.aspectRatio,
        origin,
        parentId: parent.id,
      },
      { env: context.cloudflare.env },
    )

    const headers = new Headers({ "content-type": "application/json" })
    if (voter.setCookieHeader !== null) {
      headers.set("set-cookie", voter.setCookieHeader)
    }
    return new Response(
      JSON.stringify({ id: post.id, parentId: parent.id }),
      { headers, status: 201 },
    )
  } catch (e) {
    if (e instanceof InvalidParamsError) {
      return Response.json(
        {
          error: "invalid params for provider",
          providerId: parent.content.recipe.providerId,
          issues: e.issues,
        },
        { status: 422 },
      )
    }
    if (e instanceof ApiError) {
      return Response.json(
        {
          error: "fork failed",
          providerId: parent.content.recipe.providerId,
          upstreamStatus: e.status,
          detail: e.body,
        },
        { status: 502 },
      )
    }
    return Response.json(
      {
        error: "fork failed",
        providerId: parent.content.recipe.providerId,
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    )
  }
}
