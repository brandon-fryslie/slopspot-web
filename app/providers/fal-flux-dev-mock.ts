import { z } from "zod"
import { ASPECT_RATIOS } from "~/lib/variety"
import { ProviderId, type AspectRatio, type Media } from "~/lib/domain"
import type { GenerationProvider } from "./types"

// fal-flux-dev-mock shares the real provider's params shape (prompt + steps +
// optional guidanceScale/seed) so callers can swap providerId without touching params.
// [LAW:one-source-of-truth] Dims use fal's square_hd/landscape_16_9 etc. conventions;
// values match the real provider's expected output sizes for each ratio.
const params = z.object({
  prompt: z.string().min(1).max(500),
  steps: z.number().int().min(1).max(50),
  guidanceScale: z.number().min(1).max(20).optional(),
  seed: z.number().int().optional(),
})
type Params = z.infer<typeof params>

const dims: Record<AspectRatio, { w: number; h: number }> = {
  "1:1": { w: 1024, h: 1024 },
  "16:9": { w: 1280, h: 720 },
  "9:16": { w: 720, h: 1280 },
  "4:3": { w: 1024, h: 768 },
  "3:4": { w: 768, h: 1024 },
}

export const falFluxDevMock: GenerationProvider<Params> = {
  id: ProviderId("fal-flux-dev-mock"),
  kind: 'mock',
  version: "2026-06-12",
  displayName: "fal.ai FLUX dev (mock)",
  paramsSchema: params,
  capabilities: { producesMedia: ["image"], supportsSeed: true, costEstimateUsd: 0 },
  supportedAspectRatios: ASPECT_RATIOS,
  promptMaxLength: 500,
  defaultParamsForRecipe({ prompt, seed }): Params {
    return { prompt, steps: 28, guidanceScale: 3.5, seed }
  },
  async generate({ params: p, aspectRatio }): Promise<Media> {
    const { w, h } = dims[aspectRatio]
    const url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=="
    return { kind: "image", url, w, h, alt: p.prompt }
  },
}
