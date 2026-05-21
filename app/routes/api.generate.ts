import type { Route } from "./+types/api.generate"
import { z, ZodError } from "zod"
import { ApiError } from "@fal-ai/client"
import { AgentId, ProviderId, type Origin } from "~/lib/domain"
import { getProvider } from "~/providers"
import { createPost } from "~/db/posts"

// [LAW:single-enforcer] This route is one caller of createPost — it does not
// persist, ingest, or talk to providers itself. Its only job is the HTTP trust
// boundary: parse the request, attribute an origin, and map createPost's outcome
// to a status code.

const bodySchema = z.object({
  providerId: z.string().min(1),
  params: z.unknown(),
})

// Direct API calls are attributed to a fixed agent until auth lands; the
// authenticated actor replaces this then.
const API_ORIGIN: Origin = { actor: { kind: "agent", agentId: AgentId("api") } }

export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 })
  }

  let parsed
  try {
    parsed = bodySchema.parse(await request.json())
  } catch (e) {
    return Response.json(
      { error: "invalid body", detail: String(e) },
      { status: 400 },
    )
  }

  try {
    getProvider(ProviderId(parsed.providerId))
  } catch {
    return Response.json(
      { error: "unknown provider", providerId: parsed.providerId },
      { status: 404 },
    )
  }

  try {
    const post = await createPost(
      {
        providerId: ProviderId(parsed.providerId),
        params: parsed.params,
        origin: API_ORIGIN,
      },
      { env: context.cloudflare.env },
    )
    return Response.json(post)
  } catch (e) {
    if (e instanceof ZodError) {
      return Response.json(
        {
          error: "invalid params for provider",
          providerId: parsed.providerId,
          issues: e.issues,
        },
        { status: 422 },
      )
    }
    // Surface upstream provider errors with their actual body — generic
    // `e.message` from SDKs is often just HTTP status text ("Forbidden") and
    // loses the actionable detail ("balance exhausted", etc.).
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
