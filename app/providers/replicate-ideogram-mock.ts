import { z } from "zod"
import { ASPECT_RATIOS } from "~/lib/variety"
import { ProviderId, type Media } from "~/lib/domain"
import type { GenerationProvider } from "./types"
import { IDEOGRAM_DIMS } from "./replicate-ideogram"

// Replicate Ideogram mock. Params shape is identical to the real provider
// because every callsite (HTTP route, chooser, firehose) commits to a params
// shape per providerId — the mock must accept the same shape it will accept
// in prod or the swap isn't a swap.
//
// [LAW:one-source-of-truth] Ideogram nominal dims are owned by
// ./replicate-ideogram (IDEOGRAM_DIMS). Mock and real provider render the
// same canonical AspectRatio to the same nominal (w,h).
const params = z.object({
  prompt: z.string().min(1).max(1000),
  negativePrompt: z.string().max(500).optional(),
  seed: z.number().int().min(0).max(2147483647).optional(),
  styleType: z
    .enum(['None', 'Auto', 'General', 'Realistic', 'Design', 'Render 3D', 'Anime'])
    .optional(),
  magicPromptOption: z.enum(['Auto', 'On', 'Off']).optional(),
})
type Params = z.infer<typeof params>

export const replicateIdeogramMock: GenerationProvider<Params> = {
  id: ProviderId("replicate-ideogram-mock"),
  kind: 'mock',
  version: "2026-05-24",
  displayName: "Replicate Ideogram (mock)",
  paramsSchema: params,
  capabilities: { producesMedia: ["image"], supportsSeed: true, costEstimateUsd: 0 },
  supportedAspectRatios: ASPECT_RATIOS,
  promptMaxLength: 1000,
  defaultParamsForRecipe({ prompt, seed }): Params {
    return {
      prompt,
      seed: seed & 0x7fffffff,
      styleType: 'Auto',
      magicPromptOption: 'Auto',
    }
  },
  async generate({ params: p, aspectRatio }): Promise<Media> {
    const { w, h } = IDEOGRAM_DIMS[aspectRatio]
    // Minimal 1×1 PNG as a data: URI — hermetic, no network, no redirect.
    // picsum.photos 302-redirects cross-host; worker-runtime fetch cannot follow it.
    const url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=="
    return { kind: "image", url, w, h, alt: p.prompt }
  },
}
