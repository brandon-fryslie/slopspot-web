import { z } from "zod"
import { ProviderId, type Media } from "~/lib/domain"
import type { GenerationProvider } from "./types"

// Replicate SDXL shape: prompt + negative prompt + free w/h + guidance scale + optional
// seed. Structurally different from fal-flux: continuous dimensions vs categorical
// aspect ratio, explicit seed, additional negative-prompt field. Two structurally
// different schemas is the point — proves the provider abstraction absorbs variance.
const params = z.object({
  prompt: z.string().min(1).max(1000),
  negativePrompt: z.string().max(500).optional(),
  width: z.number().int().min(256).max(2048),
  height: z.number().int().min(256).max(2048),
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
  version: "2026-05-17",
  displayName: "Replicate SDXL (mock)",
  paramsSchema: params,
  capabilities: { producesMedia: ["image"], supportsSeed: true },
  async generate(p): Promise<Media> {
    const seed = p.seed ?? hash(p.prompt)
    return {
      kind: "image",
      url: `https://picsum.photos/seed/${seed}/${p.width}/${p.height}`,
      w: p.width,
      h: p.height,
      alt: p.prompt,
    }
  },
}
