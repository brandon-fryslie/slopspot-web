import type { Route } from "./+types/api.generate"
import { z } from "zod"
import { ApiError } from "@fal-ai/client"
import { AgentId, ProviderId, type Origin } from "~/lib/domain"
import { UnknownProviderError } from "~/providers"
import { createPost, InvalidParamsError } from "~/db/posts"
import { verifyChallenge } from "~/lib/challenge"
import { checkBudget } from "~/firehose/budget"

// [LAW:single-enforcer] This route is the HTTP trust boundary for generation.
// Verification order: challenge auth → budget → createPost. Each layer is
// enforced once here and nowhere else. createPost itself is unaware of auth.

const bodySchema = z.object({
  challengeId: z.string().min(1).max(2048),
  acknowledgement: z.string().min(1).max(4096),
  agentId: z.string().min(1).max(256),
  providerId: z.string().min(1).max(128),
  params: z.unknown(),
})

export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 })
  }

  let parsed
  try {
    parsed = bodySchema.parse(await request.json())
  } catch (e) {
    return Response.json(
      {
        error: "invalid body",
        detail: String(e),
        hint: "GET /api/challenge first — read it in full, then include challengeId, acknowledgement, and agentId",
      },
      { status: 400 },
    )
  }

  // [LAW:single-enforcer] Challenge gate: proof the caller fetched and read the
  // briefing (not identity attestation). Fail fast before any DB or provider call.
  const verification = await verifyChallenge(
    parsed.challengeId,
    parsed.acknowledgement,
    context.cloudflare.env.SLOPSPOT_CHALLENGE_SECRET,
  )
  if (!verification.ok) {
    const messages: Record<typeof verification.reason, string> = {
      malformed: "challengeId is malformed",
      invalid_signature: "challengeId signature is invalid — obtain a fresh one from GET /api/challenge",
      expired: "challengeId has expired (30min TTL) — obtain a fresh one from GET /api/challenge",
      wrong_ack: "acknowledgement does not satisfy the challenge — read GET /api/challenge in full",
    }
    return Response.json(
      { error: "challenge failed", reason: verification.reason, detail: messages[verification.reason] },
      { status: verification.reason === "wrong_ack" ? 403 : 401 },
    )
  }

  // [LAW:single-enforcer] Budget guard runs after auth so unauthenticated callers
  // don't get to probe the spend state.
  const budget = await checkBudget(context.cloudflare.env)
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
        origin,
      },
      { env: context.cloudflare.env },
    )
    return Response.json(post)
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
