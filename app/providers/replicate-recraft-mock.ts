import { z } from "zod"
import { ASPECT_RATIOS } from "~/lib/variety"
import { ProviderId, type Media } from "~/lib/domain"
import type { GenerationProvider } from "./types"
import { RECRAFT_DIMS } from "./replicate-recraft"

// Replicate Recraft mock. Params shape is identical to the real provider.
// [LAW:one-source-of-truth] Nominal dims are owned by ./replicate-recraft (RECRAFT_DIMS).
const params = z.object({
  prompt: z.string().min(1).max(1000),
  style: z.enum([
    'any',
    'realistic_image',
    'digital_illustration',
    'digital_illustration/pixel_art',
    'digital_illustration/hand_drawn',
    'digital_illustration/grain',
    'digital_illustration/infantile_sketch',
    'digital_illustration/2d_art_poster',
    'digital_illustration/handmade_3d',
    'digital_illustration/hand_drawn_outline',
    'digital_illustration/engraving_color',
    'digital_illustration/2d_art_poster_2',
    'realistic_image/b_and_w',
    'realistic_image/hard_flash',
    'realistic_image/hdr',
    'realistic_image/natural_light',
    'realistic_image/studio_portrait',
    'realistic_image/enterprise',
    'realistic_image/motion_blur',
  ]).optional(),
  seed: z.number().int().optional(),
})
type Params = z.infer<typeof params>

export const replicateRecraftMock: GenerationProvider<Params> = {
  id: ProviderId("replicate-recraft-mock"),
  kind: 'mock',
  version: "2026-06-12",
  displayName: "Replicate Recraft V3 (mock)",
  paramsSchema: params,
  // supportsNegativePrompt:false — mirrors the real Recraft V3 model, whose
  // input schema has no negative_prompt; this mock ignores embalmedRelic too.
  capabilities: { producesMedia: ["image"], supportsSeed: true, supportsNegativePrompt: false, costEstimateUsd: 0 },
  supportedAspectRatios: ASPECT_RATIOS,
  promptMaxLength: 1000,
  defaultParamsForRecipe({ prompt, seed }): Params {
    return { prompt, style: 'any', seed }
  },
  async generate({ params: p, aspectRatio }): Promise<Media> {
    const { w, h } = RECRAFT_DIMS[aspectRatio]
    const url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=="
    return { kind: "image", url, w, h, alt: p.prompt }
  },
}
