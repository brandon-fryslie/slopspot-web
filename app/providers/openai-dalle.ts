import { z } from "zod"
import { ProviderId, type AspectRatio, type Media } from "~/lib/domain"
import { emitAccountHealth } from "~/observability/metrics"
import type { AccountHealthPayload } from "~/observability/metrics"
import type { GenerationProvider } from "./types"

// Real OpenAI DALL-E 3 provider. Clean, polished, "commercial design" aesthetic —
// very different character from diffusion-family models. Strong prompt adherence with
// automatic prompt rewriting by default (promptRewrite: 'auto'). DALL-E 3 only supports
// three sizes, so supportedAspectRatios is a subset: the chooser will never call generate()
// with 4:3 or 3:4. [LAW:types-are-the-program]: the constraint lives at the seam
// (supportedAspectRatios), not as a runtime branch inside generate().
const params = z.object({
  prompt: z.string().min(1).max(4000),
  quality: z.enum(['standard', 'hd']).optional(),
})
type Params = z.infer<typeof params>

// [LAW:single-enforcer] OpenAI error → account-health classification. Mirrors the
// fal and Replicate classifiers; HTTP status carries the taxonomy.
function classifyOpenAIHealth(status: number): AccountHealthPayload {
  if (status === 401 || status === 403) return { status: 'down', reason: 'auth' }
  if (status === 402) return { status: 'down', reason: 'payment' }
  if (status === 429) return { status: 'down', reason: 'quota' }
  return { status: 'degraded' }
}

// [LAW:single-enforcer] The three DALL-E 3 sizes and their canonical dimensions.
// 4:3 and 3:4 are not supported — they're excluded from supportedAspectRatios, so
// generate() will never be called with them. The default branch throws rather than
// silently mapping to a wrong shape. [LAW:no-silent-failure]
type DalleSize = '1024x1024' | '1792x1024' | '1024x1792'
function dalleSize(ar: AspectRatio): { size: DalleSize; w: number; h: number } {
  switch (ar) {
    case '1:1':  return { size: '1024x1024', w: 1024, h: 1024 }
    case '16:9': return { size: '1792x1024', w: 1792, h: 1024 }
    case '9:16': return { size: '1024x1792', w: 1024, h: 1792 }
    default:
      // [LAW:no-silent-failure] Contract violation — chooser guarantees only supported ratios.
      throw new Error(`DALL-E 3 does not support aspect ratio ${ar}`)
  }
}

// Trust-boundary schema for the OpenAI images response. DALL-E 3 returns a single
// image; `url` is present when response_format is 'url' (the default).
const openAIResponseSchema = z.object({
  data: z.array(z.object({
    url: z.string().url(),
    revised_prompt: z.string().optional(),
  })).min(1),
})

const OPENAI_IMAGES_URL = 'https://api.openai.com/v1/images/generations'
const DEFAULT_QUALITY = 'standard'

export const openAIDalle: GenerationProvider<Params> = {
  id: ProviderId("openai-dalle"),
  kind: 'real',
  version: "2026-06-12",
  displayName: "OpenAI DALL-E 3",
  paramsSchema: params,
  capabilities: { producesMedia: ["image"], supportsSeed: false, costEstimateUsd: 0.04 },
  // DALL-E 3 only supports square, landscape-16:9, and portrait-9:16. The chooser
  // samples within this set; generate() never receives 4:3 or 3:4.
  supportedAspectRatios: ['1:1', '16:9', '9:16'],
  promptMaxLength: 4000,
  defaultParamsForRecipe({ prompt }): Params {
    return { prompt, quality: DEFAULT_QUALITY }
  },
  async generate({ params: p, aspectRatio }, { env }): Promise<Media> {
    const { size, w, h } = dalleSize(aspectRatio)
    const res = await fetch(OPENAI_IMAGES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SLOPSPOT_OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: p.prompt,
        size,
        quality: p.quality ?? DEFAULT_QUALITY,
        n: 1,
      }),
    })
    if (!res.ok) {
      emitAccountHealth('openai', classifyOpenAIHealth(res.status))
      throw new Error(`OpenAI DALL-E 3 ${res.status}: ${await res.text()}`)
    }
    const parsed = openAIResponseSchema.parse(await res.json())
    emitAccountHealth('openai', { status: 'ok' })
    return { kind: "image", url: parsed.data[0].url, w, h, alt: p.prompt }
  },
}
