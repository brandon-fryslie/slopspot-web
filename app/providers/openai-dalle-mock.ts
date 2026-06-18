import { z } from "zod"
import { ProviderId, type Media } from "~/lib/domain"
import type { GenerationProvider } from "./types"

// OpenAI DALL-E 3 mock. Params shape identical to real provider.
// [LAW:one-source-of-truth] Size/dims logic mirrors openai-dalle.ts. Only 3 aspect
// ratios are supported — supportedAspectRatios is a strict subset of AspectRatio.
const params = z.object({
  prompt: z.string().min(1).max(4000),
  quality: z.enum(['standard', 'hd']).optional(),
})
type Params = z.infer<typeof params>

const dims: Record<'1:1' | '16:9' | '9:16', { w: number; h: number }> = {
  '1:1':  { w: 1024, h: 1024 },
  '16:9': { w: 1792, h: 1024 },
  '9:16': { w: 1024, h: 1792 },
}

export const openAIDalleMock: GenerationProvider<Params> = {
  id: ProviderId("openai-dalle-mock"),
  kind: 'mock',
  version: "2026-06-12",
  displayName: "OpenAI DALL-E 3 (mock)",
  paramsSchema: params,
  // supportsNegativePrompt:false — mirrors the real DALL-E 3 images API, which
  // has no negative_prompt parameter; this mock ignores embalmedRelic too.
  capabilities: { producesMedia: ["image"], supportsSeed: false, supportsNegativePrompt: false, costEstimateUsd: 0 },
  supportedAspectRatios: ['1:1', '16:9', '9:16'],
  promptMaxLength: 4000,
  defaultParamsForRecipe({ prompt }): Params {
    return { prompt, quality: 'standard' }
  },
  async generate({ params: p, aspectRatio }): Promise<Media> {
    const { w, h } = dims[aspectRatio as '1:1' | '16:9' | '9:16'] ?? { w: 1024, h: 1024 }
    const url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg=="
    return { kind: "image", url, w, h, alt: p.prompt }
  },
}
