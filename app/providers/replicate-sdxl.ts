import { z } from "zod"
import { ASPECT_RATIOS } from "~/lib/variety"
import { ProviderId, type AspectRatio, type Media } from "~/lib/domain"
import type { GenerationProvider } from "./types"
import { createPrediction, pollPrediction, predictionSchema } from "./replicate-helpers"

// Real Replicate SDXL provider. Params are provider-specific (negativePrompt,
// guidanceScale, seed — none of which fal has), so the abstraction's
// variance-absorption claim is structural, not cosmetic.
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

// [LAW:one-source-of-truth] Pinned SDXL version. Pinning buys reproducibility
// — same hash, same model weights — and makes a quality regression a visible
// diff rather than a silent rotation.
const SDXL_MODEL_VERSION = '7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc'

export const replicateSdxl: GenerationProvider<Params> = {
  id: ProviderId("replicate-sdxl"),
  version: "2026-05-24",
  displayName: "Replicate SDXL",
  paramsSchema: params,
  capabilities: { producesMedia: ["image"], supportsSeed: true, costEstimateUsd: 0.0035 },
  supportedAspectRatios: ASPECT_RATIOS,
  async generate({ params: p, aspectRatio }, { env }): Promise<Media> {
    const { w, h } = SDXL_DIMS[aspectRatio]
    const input = {
      prompt: p.prompt,
      ...(p.negativePrompt !== undefined ? { negative_prompt: p.negativePrompt } : {}),
      width: w,
      height: h,
      num_outputs: 1,
      guidance_scale: p.guidanceScale,
      ...(p.seed !== undefined ? { seed: p.seed } : {}),
    }
    const initial = await createPrediction({
      version: SDXL_MODEL_VERSION,
      input,
      token: env.SLOPSPOT_REPLICATE_API_KEY,
    })
    const terminal = await pollPrediction(initial, env.SLOPSPOT_REPLICATE_API_KEY)
    return parseReplicateSdxlResponse(terminal, { alt: p.prompt, w, h })
  },
}
