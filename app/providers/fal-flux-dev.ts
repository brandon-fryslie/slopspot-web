import { fal } from "@fal-ai/client"
import { z } from "zod"
import { ASPECT_RATIOS } from "~/lib/variety"
import { ProviderId, type AspectRatio, type Media } from "~/lib/domain"
import { emitAccountHealth } from "~/observability/metrics"
import type { GenerationProvider } from "./types"
import { classifyFalHealth, parseFalFluxResponse } from "./fal-flux"

// Real fal.ai FLUX dev provider. Higher quality than schnell (~20-50 steps vs 4),
// photorealistic territory with proper lighting and detail. Uses the same fal client,
// the same image_size enum, and the same response envelope as fal-flux — only the
// model string and step range differ. [LAW:one-type-per-behavior]: the response parser
// is shared rather than duplicated because the fal image-array envelope is invariant
// across FLUX models.
const params = z.object({
  prompt: z.string().min(1).max(500),
  steps: z.number().int().min(1).max(50),
  // FLUX Dev responds to guidance_scale; schnell ignores it. Per fal docs, 3.5 is the
  // sweet spot — too high flattens detail, too low loses prompt adherence.
  guidanceScale: z.number().min(1).max(20).optional(),
  seed: z.number().int().optional(),
})
type Params = z.infer<typeof params>

// [LAW:single-enforcer] Canonical AspectRatio → fal image_size enum. Identical mapping
// to fal-flux schnell — fal's enum is model-agnostic across the FLUX family.
const imageSize: Record<
  AspectRatio,
  | "square_hd"
  | "landscape_16_9"
  | "portrait_16_9"
  | "landscape_4_3"
  | "portrait_4_3"
> = {
  "1:1": "square_hd",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
}

const FLUX_DEV_DEFAULT_STEPS = 28
const FLUX_DEV_DEFAULT_GUIDANCE = 3.5

export const falFluxDev: GenerationProvider<Params> = {
  id: ProviderId("fal-flux-dev"),
  kind: 'real',
  version: "2026-06-12",
  displayName: "fal.ai FLUX dev",
  paramsSchema: params,
  capabilities: { producesMedia: ["image"], supportsSeed: true, costEstimateUsd: 0.025 },
  supportedAspectRatios: ASPECT_RATIOS,
  promptMaxLength: 500,
  defaultParamsForRecipe({ prompt, seed }): Params {
    return { prompt, steps: FLUX_DEV_DEFAULT_STEPS, guidanceScale: FLUX_DEV_DEFAULT_GUIDANCE, seed }
  },
  async generate({ params: p, aspectRatio }, { env }): Promise<Media> {
    fal.config({ credentials: env.SLOPSPOT_FAL_API_KEY })
    try {
      const result = await fal.run("fal-ai/flux/dev", {
        input: {
          prompt: p.prompt,
          image_size: imageSize[aspectRatio],
          num_inference_steps: p.steps,
          ...(p.guidanceScale !== undefined ? { guidance_scale: p.guidanceScale } : {}),
          ...(p.seed !== undefined ? { seed: p.seed } : {}),
        },
      })
      emitAccountHealth('fal', { status: 'ok' })
      return parseFalFluxResponse(result.data, p.prompt)
    } catch (err) {
      emitAccountHealth('fal', classifyFalHealth(err))
      throw err
    }
  },
}
