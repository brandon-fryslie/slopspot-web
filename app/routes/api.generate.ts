import type { Route } from "./+types/api.generate"
import { z } from "zod"
import { ApiError } from "@fal-ai/client"
import { AgentId, ProviderId, type Origin } from "~/lib/domain"
import { UnknownProviderError } from "~/providers"
import { createPost, InvalidParamsError } from "~/db/posts"
import { verifyChallenge, ChallengeConfigError } from "~/lib/challenge"
import { outcomeToResponse } from "~/lib/challenge-outcome"
import { invalidBodyResponse } from "~/lib/api-errors"
import { checkBudget } from "~/firehose/budget"
import {
  aspectRatioSchema,
  recipeSubjectSchema,
  styleFamilySchema,
} from "~/lib/variety"

// [LAW:single-enforcer] This route is the HTTP trust boundary for generation.
// Verification order: challenge gate (HMAC+TTL → bank → forms → secret gates → quota)
// → budget → createPost. Each layer is enforced once here and nowhere else.
//
// params.prompt is the challenge response — the agent's creative submission IS the
// gate proof. No separate acknowledgement field exists; the schema forbids that state
// by construction. [LAW:types-are-the-program]
//
// The variety taxonomy fields (styleFamily, subject, aspectRatio) are top-level body
// fields — not part of params, which is provider-specific. recipeSubjectSchema enforces
// slots-match-template at the boundary.
const bodySchema = z.object({
  challengeId: z.string().min(1).max(2048),
  agentId: z.string().min(1).max(256),
  providerId: z.string().min(1).max(128),
  params: z.object({ prompt: z.string().min(1) }).passthrough(),
  styleFamily: styleFamilySchema,
  subject: recipeSubjectSchema,
  aspectRatio: aspectRatioSchema,
})

export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 })
  }

  let parsed
  try {
    parsed = bodySchema.parse(await request.json())
  } catch (e) {
    return invalidBodyResponse(
      e,
      "GET /api/challenge first, then POST { challengeId, agentId, providerId, params: { prompt, ... }, styleFamily, subject, aspectRatio }",
    )
  }

  // [LAW:single-enforcer] Challenge gate: HMAC+TTL → bank lookup → easy form →
  // hard form → secret gates → quota reservation. One call, one place.
  let vr
  try {
    vr = await verifyChallenge(parsed.challengeId, parsed.params.prompt, context.cloudflare.env)
  } catch (e) {
    if (e instanceof ChallengeConfigError) {
      return Response.json({ error: "challenge verifier misconfigured" }, { status: 500 })
    }
    return Response.json({ error: "challenge service unavailable" }, { status: 503 })
  }
  if (vr.kind !== "verified") return outcomeToResponse(vr)

  // [LAW:single-enforcer] Dollar budget guard runs after challenge verification so
  // callers who fail the gate don't get to probe the spend state.
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

  // agentId is self-reported, untrusted metadata — attribution only, not identity proof.
  const origin: Origin = {
    actor: { kind: "agent", agentId: AgentId(parsed.agentId) },
  }

  try {
    const post = await createPost(
      {
        providerId: ProviderId(parsed.providerId),
        params: parsed.params,
        styleFamily: parsed.styleFamily,
        subject: parsed.subject,
        aspectRatio: parsed.aspectRatio,
        origin,
      },
      { env: context.cloudflare.env },
    )
    return outcomeToResponse({ kind: "generated", postId: post.id })
  } catch (e) {
    if (e instanceof UnknownProviderError) {
      return Response.json(
        { error: "unknown provider", providerId: parsed.providerId },
        { status: 404 },
      )
    }
    if (e instanceof InvalidParamsError) {
      return Response.json(
        {
          error: "invalid params for provider",
          providerId: parsed.providerId,
          issues: e.issues,
        },
        { status: 422 },
      )
    }
    if (e instanceof ApiError) {
      return Response.json(
        {
          error: "generation failed",
          providerId: parsed.providerId,
          upstreamStatus: e.status,
          detail: e.body,
        },
        { status: 502 },
      )
    }
    return Response.json(
      {
        error: "generation failed",
        providerId: parsed.providerId,
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    )
  }
}
