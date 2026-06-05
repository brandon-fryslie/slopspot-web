import { z } from "zod"
import { ASPECT_RATIOS } from "~/lib/variety"
import { ProviderId, type AspectRatio, type Media } from "~/lib/domain"
import type { GenerationProvider } from "./types"

// fal-flux-mock shares the real provider's *params shape* exactly (prompt + step
// count) so callers can swap providerId without touching paramsSchema. The
// canonical aspectRatio lives on GenerationInput, not in params; this mock
// translates it to (w,h) dimensions the same way the real provider does.
const params = z.object({
  prompt: z.string().min(1).max(500),
  steps: z.number().int().min(1).max(50),
})
type Params = z.infer<typeof params>

const dims: Record<AspectRatio, { w: number; h: number }> = {
  "1:1": { w: 1024, h: 1024 },
  "16:9": { w: 1280, h: 720 },
  "9:16": { w: 720, h: 1280 },
  "4:3": { w: 1024, h: 768 },
  "3:4": { w: 768, h: 1024 },
}

export const falFluxMock: GenerationProvider<Params> = {
  id: ProviderId("fal-flux-mock"),
  kind: 'mock',
  version: "2026-05-24",
  displayName: "fal.ai FLUX (mock)",
  paramsSchema: params,
  capabilities: { producesMedia: ["image"], supportsSeed: false, costEstimateUsd: 0 },
  supportedAspectRatios: ASPECT_RATIOS,
  promptMaxLength: 500,
  defaultParamsForRecipe({ prompt }): Params {
    return { prompt, steps: 4 }
  },
  async generate({ params: p, aspectRatio }): Promise<Media> {
    const { w, h } = dims[aspectRatio]
    // Minimal 1×1 PNG as a data: URI — Node.js fetch supports data: URIs so
    // ingestImage can fetch, hash, and store it without a network round-trip.
    // Replaces the picsum.photos URL that now returns 405 in local dev.
    const url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=="
    return { kind: "image", url, w, h, alt: p.prompt }
  },
}
