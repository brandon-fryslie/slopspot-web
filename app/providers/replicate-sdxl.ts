import { z } from "zod"
import { ASPECT_RATIOS } from "~/lib/variety"
import { ProviderId, type Media } from "~/lib/domain"
import type { GenerationProvider } from "./types"
import {
  REPLICATE_CANONICAL_DIMS,
  createPrediction,
  pollPrediction,
  predictionSchema,
} from "./replicate-helpers"

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

// SDXL's native (w,h) per canonical AspectRatio is the shared
// REPLICATE_CANONICAL_DIMS table in `./replicate-helpers`. Re-exported under
// the SDXL_DIMS name for backwards-compatible test imports.
export const SDXL_DIMS = REPLICATE_CANONICAL_DIMS

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

// SDXL's neutral guidance scale — high enough to follow the prompt, low enough
// not to over-saturate stylization. The chooser doesn't (yet) vary this by
// style; if pl6.6 wants to push painterly styles toward higher guidance,
// that's a per-style table here.
const SDXL_DEFAULT_GUIDANCE = 7.5

export const replicateSdxl: GenerationProvider<Params> = {
  id: ProviderId("replicate-sdxl"),
  version: "2026-05-24",
  displayName: "Replicate SDXL",
  paramsSchema: params,
  capabilities: { producesMedia: ["image"], supportsSeed: true, costEstimateUsd: 0.0035 },
  supportedAspectRatios: ASPECT_RATIOS,
  promptMaxLength: 1000,
  defaultParamsForRecipe({ prompt, seed }): Params {
    return { prompt, guidanceScale: SDXL_DEFAULT_GUIDANCE, seed }
  },
  async generate({ params: p, aspectRatio }, { env }): Promise<Media> {
    const { w, h } = REPLICATE_CANONICAL_DIMS[aspectRatio]
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
