import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError } from '@fal-ai/client'
import { ProviderId } from '@/domain'
import { getProvider } from '@/providers'

// [LAW:single-enforcer] Generation requests dispatch through the provider registry.
// This route does not know about fal.ai, Replicate, or anyone else — it knows
// "providerId + params" and asks the registry to dispatch.

const bodySchema = z.object({
  providerId: z.string().min(1),
  params: z.unknown(),
})

export async function POST(req: Request) {
  let parsed
  try {
    parsed = bodySchema.parse(await req.json())
  } catch (e) {
    return NextResponse.json({ error: 'invalid body', detail: String(e) }, { status: 400 })
  }

  let provider
  try {
    provider = getProvider(ProviderId(parsed.providerId))
  } catch {
    return NextResponse.json({ error: 'unknown provider', providerId: parsed.providerId }, { status: 404 })
  }

  const paramsResult = provider.paramsSchema.safeParse(parsed.params)
  if (!paramsResult.success) {
    return NextResponse.json(
      { error: 'invalid params for provider', providerId: parsed.providerId, issues: paramsResult.error.issues },
      { status: 422 },
    )
  }

  try {
    const media = await provider.generate(paramsResult.data)
    return NextResponse.json({
      providerId: provider.id,
      providerVersion: provider.version,
      media,
    })
  } catch (e) {
    // Surface upstream provider errors with their actual body — generic
    // `e.message` from SDKs is often just the HTTP status text ("Forbidden")
    // and loses the actionable detail ("balance exhausted", etc.).
    if (e instanceof ApiError) {
      return NextResponse.json(
        { error: 'generation failed', providerId: parsed.providerId, upstreamStatus: e.status, detail: e.body },
        { status: 502 },
      )
    }
    return NextResponse.json(
      { error: 'generation failed', providerId: parsed.providerId, detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    )
  }
}
