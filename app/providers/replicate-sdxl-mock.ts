import { z } from "zod"
import { ASPECT_RATIOS } from "~/lib/variety"
import { ProviderId, type AspectRatio, type Media } from "~/lib/domain"
import type { GenerationProvider } from "./types"

// Replicate SDXL mock. Params remain *structurally different* from fal-flux:
// negativePrompt, guidanceScale, seed — none of which fal has. That asymmetry
// is the point — the provider abstraction has to absorb genuine variance, not
// just be the same shape in three files.
//
// What previously lived in params and no longer does: width/height. Per the
// variety design doc those derive from the canonical AspectRatio token (see
// dims below), so the provider receives `aspectRatio` via GenerationInput and
// translates here. [LAW:single-enforcer] one provider-native translation site.
const params = z.object({
  prompt: z.string().min(1).max(1000),
  negativePrompt: z.string().max(500).optional(),
  guidanceScale: z.number().min(0).max(20),
  seed: z.number().int().optional(),
})
type Params = z.infer<typeof params>

// AspectRatio → (w,h) table from the variety design doc's §Aspect ratio policy.
const dims: Record<AspectRatio, { w: number; h: number }> = {
  "1:1": { w: 1024, h: 1024 },
  "16:9": { w: 1344, h: 768 },
  "9:16": { w: 768, h: 1344 },
  "4:3": { w: 1152, h: 896 },
  "3:4": { w: 896, h: 1152 },
}

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
  async generate({ params: p, aspectRatio }): Promise<Media> {
    const { w, h } = dims[aspectRatio]
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
