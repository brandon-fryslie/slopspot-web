import { z } from "zod"
import { ASPECT_RATIOS } from "~/lib/variety"
import { ProviderId, type AspectRatio, type Media } from "~/lib/domain"
import type { GenerationProvider } from "./types"
import { createPrediction, pollPrediction, predictionSchema } from "./replicate-helpers"

// Real Replicate Ideogram v2-turbo provider. The "third aesthetic signature"
// for the variety epic — ideogram's strength is typography-in-image and
// designed-flat aesthetics that neither FLUX schnell (photographic) nor SDXL
// (painterly) cover well. Output style is its own tonal cluster, which is
// the whole point of having a third provider.
//
// [LAW:single-enforcer] Canonical AspectRatio is not in paramsSchema; it
// arrives via GenerationInput.aspectRatio and is translated to ideogram's
// native aspect_ratio enum at this boundary.
const params = z.object({
  prompt: z.string().min(1).max(1000),
  negativePrompt: z.string().max(500).optional(),
  // Ideogram's seed is a non-negative 32-bit int per its OpenAPI schema.
  seed: z.number().int().min(0).max(2147483647).optional(),
  // The enum strings are ideogram's native API values verbatim ("Render 3D",
  // "Anime"). Lifting them into a TS-style enum would add a second
  // translation layer for no domain win.
  styleType: z
    .enum(['None', 'Auto', 'General', 'Realistic', 'Design', 'Render 3D', 'Anime'])
    .optional(),
  magicPromptOption: z.enum(['Auto', 'On', 'Off']).optional(),
})
type Params = z.infer<typeof params>

// [LAW:single-enforcer] Canonical AspectRatio → ideogram's native aspect_ratio
// enum. The strings happen to be byte-identical for the 5 we use, but the
// translation site stays explicit — a future ideogram model change (e.g.
// renaming to "1x1") becomes a one-line diff here, not a silent assumption
// that "canonical == native" baked into the generate() call.
const IDEOGRAM_ASPECT_RATIO: Record<AspectRatio, '1:1' | '16:9' | '9:16' | '4:3' | '3:4'> = {
  '1:1': '1:1',
  '16:9': '16:9',
  '9:16': '9:16',
  '4:3': '4:3',
  '3:4': '3:4',
}

// [LAW:one-source-of-truth] Nominal dimensions per canonical AspectRatio.
// Ideogram's API doesn't echo dims in the response (output is a single URL,
// no width/height field), and the `aspect_ratio` input picks an internal
// resolution we don't control exactly. These are the canonical dims we
// advertise downstream — Media.w/h is used for layout / aspect preservation,
// not for byte-level dim assertions (the stored image is content-addressed
// in R2). Values match SDXL's table so the feed has a single mental model
// of "what does ratio X mean in pixels".
export const IDEOGRAM_DIMS: Record<AspectRatio, { w: number; h: number }> = {
  '1:1': { w: 1024, h: 1024 },
  '16:9': { w: 1344, h: 768 },
  '9:16': { w: 768, h: 1344 },
  '4:3': { w: 1152, h: 864 },
  '3:4': { w: 864, h: 1152 },
}

// Ideogram v2-turbo returns a single string URL as `output`, not an array
// (unlike SDXL which returns string[]). Trust-boundary schema reflects that
// exact shape — passing an array here is a contract violation, not a
// "first element" accident.
const succeededOutputSchema = z.string().url()

// [LAW:single-enforcer] The seam between Replicate's prediction envelope and
// our domain Media for ideogram lives here as one named function. Mirror of
// parseReplicateSdxlResponse but with the single-URL output shape.
export function parseReplicateIdeogramResponse(
  data: unknown,
  opts: { alt: string; w: number; h: number },
): Media {
  const prediction = predictionSchema.parse(data)
  if (prediction.status !== 'succeeded') {
    const err = typeof prediction.error === 'string' ? prediction.error : JSON.stringify(prediction.error ?? null)
    throw new Error(`Replicate prediction ${prediction.id} not succeeded: status=${prediction.status} error=${err}`)
  }
  const url = succeededOutputSchema.parse(prediction.output)
  return { kind: "image", url, w: opts.w, h: opts.h, alt: opts.alt }
}

// [LAW:one-source-of-truth] Pinned ideogram-v2-turbo version. Same rationale
// as SDXL: ideogram is community-hosted, so the auto-latest endpoint 404s and
// we post to `/v1/predictions` with an explicit version. Pinning buys
// reproducibility — a model rotation becomes a visible diff.
const IDEOGRAM_MODEL_VERSION = '7cef9d520d672bb802588ad0d13151bc51aee9a408c270aebf25d6530045dd29'

export const replicateIdeogram: GenerationProvider<Params> = {
  id: ProviderId("replicate-ideogram"),
  version: "2026-05-24",
  displayName: "Replicate Ideogram v2 Turbo",
  paramsSchema: params,
  // Replicate price as of 2025-11: $0.025/image for ideogram-v2-turbo. Used
  // by the firehose budget guard to enforce the daily spend ceiling.
  capabilities: { producesMedia: ["image"], supportsSeed: true, costEstimateUsd: 0.025 },
  supportedAspectRatios: ASPECT_RATIOS,
  async generate({ params: p, aspectRatio }, { env }): Promise<Media> {
    const { w, h } = IDEOGRAM_DIMS[aspectRatio]
    const input = {
      prompt: p.prompt,
      aspect_ratio: IDEOGRAM_ASPECT_RATIO[aspectRatio],
      ...(p.negativePrompt !== undefined ? { negative_prompt: p.negativePrompt } : {}),
      ...(p.seed !== undefined ? { seed: p.seed } : {}),
      ...(p.styleType !== undefined ? { style_type: p.styleType } : {}),
      ...(p.magicPromptOption !== undefined ? { magic_prompt_option: p.magicPromptOption } : {}),
    }
    const initial = await createPrediction({
      version: IDEOGRAM_MODEL_VERSION,
      input,
      token: env.SLOPSPOT_REPLICATE_API_KEY,
    })
    const terminal = await pollPrediction(initial, env.SLOPSPOT_REPLICATE_API_KEY)
    return parseReplicateIdeogramResponse(terminal, { alt: p.prompt, w, h })
  },
}
