import { z } from "zod"
import { ASPECT_RATIOS } from "~/lib/variety"
import { ProviderId, type Media } from "~/lib/domain"
import type { GenerationProvider } from "./types"
import { SDXL_DIMS } from "./replicate-sdxl"

// Replicate SDXL mock. Params remain *structurally different* from fal-flux:
// negativePrompt, guidanceScale, seed — none of which fal has. That asymmetry
// is the point — the provider abstraction has to absorb genuine variance, not
// just be the same shape in three files.
//
// [LAW:one-source-of-truth] SDXL native dims are owned by ./replicate-sdxl
// (SDXL_DIMS). Mock and real provider render the same canonical AspectRatio
// to the same (w,h) — there is no scenario where they should diverge.
const params = z.object({
  prompt: z.string().min(1).max(1000),
  negativePrompt: z.string().max(500).optional(),
  guidanceScale: z.number().min(0).max(20),
  seed: z.number().int().optional(),
})
type Params = z.infer<typeof params>

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export const replicateSdxlMock: GenerationProvider<Params> = {
  id: ProviderId("replicate-sdxl-mock"),
  version: "2026-05-24",
  displayName: "Replicate SDXL (mock)",
  paramsSchema: params,
  capabilities: { producesMedia: ["image"], supportsSeed: true, costEstimateUsd: 0 },
  supportedAspectRatios: ASPECT_RATIOS,
  promptMaxLength: 1000,
  defaultParamsForRecipe({ prompt, seed }): Params {
    return { prompt, guidanceScale: 7.5, seed }
  },
  async generate({ params: p, aspectRatio }): Promise<Media> {
    const { w, h } = SDXL_DIMS[aspectRatio]
    const seed = p.seed ?? hash(p.prompt)
    return {
      kind: "image",
      url: `https://picsum.photos/seed/${seed}/${w}/${h}`,
      w,
      h,
      alt: p.prompt,
    }
  },
}
