import { z } from "zod"
import { ASPECT_RATIOS } from "~/lib/variety"
import { ProviderId, type AspectRatio, type Media } from "~/lib/domain"
import type { GenerationProvider } from "./types"

// Real Replicate SDXL provider. Sibling to the mock — params shape is identical
// (negativePrompt, guidanceScale, seed — none of which fal has), so the
// abstraction's variance-absorption claim is structural, not cosmetic.
//
// Canonical AspectRatio is *not* in paramsSchema; it arrives via
// GenerationInput.aspectRatio and is translated to SDXL-native (w,h) at this
// boundary. [LAW:single-enforcer] one provider-native translation site.
const params = z.object({
  prompt: z.string().min(1).max(1000),
  negativePrompt: z.string().max(500).optional(),
  guidanceScale: z.number().min(0).max(20),
  seed: z.number().int().optional(),
})
type Params = z.infer<typeof params>

// [LAW:one-source-of-truth] SDXL's native dims by canonical AspectRatio. Both
// the real provider and the mock consult this same constant — there is exactly
// one answer to "what dimensions does SDXL render for ratio X". Values are
// from the variety design doc's §Aspect ratio policy.
export const SDXL_DIMS: Record<AspectRatio, { w: number; h: number }> = {
  "1:1": { w: 1024, h: 1024 },
  "16:9": { w: 1344, h: 768 },
  "9:16": { w: 768, h: 1344 },
  "4:3": { w: 1152, h: 896 },
  "3:4": { w: 896, h: 1152 },
}

// [LAW:no-defensive-null-guards] Trust-boundary schema for the Replicate
// prediction envelope. `output` is unknown here because its shape is
// status-dependent (null while running, model-specific when succeeded);
// `succeededOutputSchema` below parses it once we know we're succeeded.
const PREDICTION_STATUSES = ['starting', 'processing', 'succeeded', 'failed', 'canceled'] as const
const predictionSchema = z.object({
  id: z.string(),
  status: z.enum(PREDICTION_STATUSES),
  output: z.unknown().nullable(),
  error: z.unknown().nullable().optional(),
  urls: z.object({ get: z.string().url() }).optional(),
})
type Prediction = z.infer<typeof predictionSchema>

// SDXL with num_outputs:1 returns a one-element string[] of image URLs.
const succeededOutputSchema = z.array(z.string().url()).min(1)

// [LAW:single-enforcer] The seam between Replicate's prediction object and our
// domain Media lives here as one named function. The provider's generate()
// calls it; the test pins its behavior. Dimensions come from opts because
// Replicate's response doesn't echo them — we know what we sent.
export function parseReplicateSdxlResponse(
  data: unknown,
  opts: { alt: string; w: number; h: number },
): Media {
  const prediction = predictionSchema.parse(data)
  if (prediction.status !== 'succeeded') {
    const err = typeof prediction.error === 'string' ? prediction.error : JSON.stringify(prediction.error ?? null)
    throw new Error(`Replicate prediction ${prediction.id} not succeeded: status=${prediction.status} error=${err}`)
  }
  const urls = succeededOutputSchema.parse(prediction.output)
  return { kind: "image", url: urls[0], w: opts.w, h: opts.h, alt: opts.alt }
}

const REPLICATE_PREDICTIONS_URL = 'https://api.replicate.com/v1/predictions'
// [LAW:one-source-of-truth] Pinned SDXL version. Replicate's
// `/v1/models/{owner}/{name}/predictions` (auto-latest) is restricted to
// "official models" and 404s for community-hosted `stability-ai/sdxl`, so we
// post to `/v1/predictions` with an explicit `version`. Pinning also buys
// reproducibility — same hash, same model weights — and makes a quality
// regression a visible diff rather than a silent rotation.
const SDXL_MODEL_VERSION = '7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc'
const POLL_INTERVAL_MS = 2000
// Server-side wait via Prefer: wait=60 covers the common case (SDXL is
// typically 5-20s). Fallback polling covers the long tail. Budget is generous
// because cron handlers have ~30s CPU but minutes of wall-clock for awaited fetch.
const MAX_POLLS = 30

async function pollPrediction(prediction: Prediction, token: string): Promise<Prediction> {
  let current = prediction
  let polls = 0
  while (current.status === 'starting' || current.status === 'processing') {
    if (polls >= MAX_POLLS) {
      throw new Error(`Replicate prediction ${current.id} did not terminate within ${MAX_POLLS * POLL_INTERVAL_MS}ms of polling`)
    }
    if (!current.urls?.get) {
      throw new Error(`Replicate prediction ${current.id} missing urls.get for polling`)
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const res = await fetch(current.urls.get, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      throw new Error(`Replicate poll failed: ${res.status} ${await res.text()}`)
    }
    current = predictionSchema.parse(await res.json())
    polls += 1
  }
  return current
}

export const replicateSdxl: GenerationProvider<Params> = {
  id: ProviderId("replicate-sdxl"),
  version: "2026-05-24",
  displayName: "Replicate SDXL",
  paramsSchema: params,
  capabilities: { producesMedia: ["image"], supportsSeed: true, costEstimateUsd: 0.0035 },
  supportedAspectRatios: ASPECT_RATIOS,
  async generate({ params: p, aspectRatio }, { env }): Promise<Media> {
    const { w, h } = SDXL_DIMS[aspectRatio]
    const body = {
      version: SDXL_MODEL_VERSION,
      input: {
        prompt: p.prompt,
        ...(p.negativePrompt !== undefined ? { negative_prompt: p.negativePrompt } : {}),
        width: w,
        height: h,
        num_outputs: 1,
        guidance_scale: p.guidanceScale,
        ...(p.seed !== undefined ? { seed: p.seed } : {}),
      },
    }
    const createRes = await fetch(REPLICATE_PREDICTIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SLOPSPOT_REPLICATE_API_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'wait=60',
      },
      body: JSON.stringify(body),
    })
    if (!createRes.ok) {
      throw new Error(`Replicate create failed: ${createRes.status} ${await createRes.text()}`)
    }
    const initial = predictionSchema.parse(await createRes.json())
    const terminal = await pollPrediction(initial, env.SLOPSPOT_REPLICATE_API_KEY)
    return parseReplicateSdxlResponse(terminal, { alt: p.prompt, w, h })
  },
}
