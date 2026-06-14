import { ApiError, fal } from "@fal-ai/client"
import { z } from "zod"
import { ASPECT_RATIOS } from "~/lib/variety"
import { ProviderId, type AspectRatio, type Media } from "~/lib/domain"
import { emitAccountHealth, type AccountHealthPayload } from "~/observability/metrics"
import type { GenerationProvider } from "./types"

// [LAW:single-enforcer] Classification for fal.ai call outcomes → account-health axis.
// ApiError carries a typed .status so the mapping is purely data-driven. Exported
// so fal-based providers (flux/dev, etc.) share one classifier without a second copy.
export function classifyFalHealth(err: unknown): AccountHealthPayload {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) return { status: 'down', reason: 'auth' }
    if (err.status === 402) return { status: 'down', reason: 'payment' }
    if (err.status === 429) return { status: 'down', reason: 'quota' }
  }
  return { status: 'degraded' }
}

// Real fal.ai FLUX schnell provider. Params are provider-specific (prompt +
// step count, with schnell's tighter 1-4 bound). The canonical aspectRatio
// no longer lives in params — it arrives as GenerationInput.aspectRatio and
// is translated to fal's image_size enum at this boundary (see imageSize
// below). [LAW:single-enforcer] one canonical AspectRatio → one provider-
// native translation site per provider.
const params = z.object({
  prompt: z.string().min(1).max(500),
  steps: z.number().int().min(1).max(4),
})
type Params = z.infer<typeof params>

// fal's image_size enum, keyed by the canonical AspectRatio token. fal supports
// all 5 ratios; the previous schema only exposed 3 — the rest is the variety
// epic widening the supported set, not a fal change. [LAW:single-enforcer]
// changes to this table happen exactly here.
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

// [LAW:no-defensive-null-guards] This is a *trust boundary* parse, not a
// defensive guard. fal's response shape is external; we validate at the seam.
const responseSchema = z.object({
  images: z.array(z.object({
    url: z.string().url(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    content_type: z.string().optional(),
  })).min(1),
  seed: z.number().optional(),
})

// [LAW:single-enforcer] The seam between fal's response bytes and our domain
// Media lives here as one named function. The provider's generate() calls it;
// the test pins its behavior. Refactoring the response shape touches one place.
export function parseFalFluxResponse(data: unknown, alt: string): Media {
  const parsed = responseSchema.parse(data)
  const first = parsed.images[0]
  return { kind: "image", url: first.url, w: first.width, h: first.height, alt }
}

// fal-flux schnell tops out at 4 inference steps; 4 is the cheapest
// non-degenerate output. No style influence, no seed (schnell doesn't support
// it) — the chooser's seed argument is ignored by construction.
const FIREHOSE_STEPS = 4

export const falFlux: GenerationProvider<Params> = {
  id: ProviderId("fal-flux"),
  kind: 'real',
  version: "2026-05-24",
  displayName: "fal.ai FLUX schnell",
  paramsSchema: params,
  capabilities: { producesMedia: ["image"], supportsSeed: false, costEstimateUsd: 0.003 },
  supportedAspectRatios: ASPECT_RATIOS,
  promptMaxLength: 500,
  defaultParamsForRecipe({ prompt }): Params {
    return { prompt, steps: FIREHOSE_STEPS }
  },
  async generate({ params: p, aspectRatio }, { env }): Promise<Media> {
    fal.config({ credentials: env.SLOPSPOT_FAL_API_KEY })
    try {
      const result = await fal.run("fal-ai/flux/schnell", {
        input: {
          prompt: p.prompt,
          image_size: imageSize[aspectRatio],
          num_inference_steps: p.steps,
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
