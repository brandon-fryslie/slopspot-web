import { z } from "zod"
import { ASPECT_RATIOS } from "~/lib/variety"
import { ProviderId, type AspectRatio, type Media, type StyleFamily } from "~/lib/domain"
import type { GenerationProvider } from "./types"
import {
  REPLICATE_CANONICAL_DIMS,
  classifyReplicateHealth,
  createPrediction,
  pollPrediction,
  predictionSchema,
} from "./replicate-helpers"
import { emitAccountHealth } from "~/observability/metrics"

// Real Replicate Recraft V3 provider. The "fourth aesthetic signature" — Recraft's
// strength is polished illustration: bold graphic design, engraving-style line work,
// vaporwave grids, and grain-textured flat prints that neither FLUX (photographic),
// SDXL (painterly), nor Ideogram (typography) cover well.
//
// [LAW:single-enforcer] Canonical AspectRatio is not in paramsSchema; it arrives via
// GenerationInput.aspectRatio. Recraft's native `aspect_ratio` enum happens to match
// our canonical tokens byte-for-byte — the translation map is still explicit to isolate
// any future model API rename to this one site.
const params = z.object({
  prompt: z.string().min(1).max(1000),
  // Recraft's style enum; sub-styles use slash notation ("digital_illustration/grain").
  // 'any' is the model's auto-select mode. [LAW:dataflow-not-control-flow]: the style
  // value is a first-class param, not a branch in generate().
  style: z.enum([
    'any',
    'realistic_image',
    'digital_illustration',
    'digital_illustration/pixel_art',
    'digital_illustration/hand_drawn',
    'digital_illustration/grain',
    'digital_illustration/infantile_sketch',
    'digital_illustration/2d_art_poster',
    'digital_illustration/handmade_3d',
    'digital_illustration/hand_drawn_outline',
    'digital_illustration/engraving_color',
    'digital_illustration/2d_art_poster_2',
    'realistic_image/b_and_w',
    'realistic_image/hard_flash',
    'realistic_image/hdr',
    'realistic_image/natural_light',
    'realistic_image/studio_portrait',
    'realistic_image/enterprise',
    'realistic_image/motion_blur',
  ]).optional(),
  seed: z.number().int().optional(),
})
type Params = z.infer<typeof params>

// [LAW:single-enforcer] Canonical AspectRatio → Recraft's native aspect_ratio enum.
// The strings are byte-identical to our canonical tokens for all 5 supported ratios.
// The explicit map keeps the translation isolated — a future Recraft rename becomes a
// one-line diff here.
const RECRAFT_ASPECT_RATIO: Record<AspectRatio, string> = {
  '1:1': '1:1',
  '16:9': '16:9',
  '9:16': '9:16',
  '4:3': '4:3',
  '3:4': '3:4',
}

// Recraft doesn't echo back dimensions in the response. Use the closest size enum
// values as the nominal (w,h) for Media. [LAW:one-source-of-truth]: these live here
// rather than in replicate-helpers because they're Recraft-specific, not shared.
export const RECRAFT_DIMS: Record<AspectRatio, { w: number; h: number }> = {
  '1:1': { w: 1024, h: 1024 },
  '16:9': { w: 1820, h: 1024 },
  '9:16': { w: 1024, h: 1820 },
  '4:3': { w: 1365, h: 1024 },
  '3:4': { w: 1024, h: 1365 },
}

// [LAW:locality-or-seam] Style → Recraft style lives here, in the provider file.
// The chooser doesn't know Recraft has a style field; Recraft doesn't know the chooser
// exists. They meet at the recipe boundary, same pattern as Ideogram's styleType map.
// [LAW:dataflow-not-control-flow]: every StyleFamily has an explicit value — no branch.
type RecraftStyle = NonNullable<Params['style']>
const STYLE_TO_RECRAFT_STYLE: Record<StyleFamily, RecraftStyle> = {
  'oil-painting':           'realistic_image/natural_light',
  'photoreal':              'realistic_image/natural_light',
  'cyberpunk-neon':         'digital_illustration/2d_art_poster',
  'liminal':                'realistic_image/hard_flash',
  'low-poly':               'digital_illustration',
  'vaporwave':              'digital_illustration/2d_art_poster',
  'watercolor':             'digital_illustration/hand_drawn',
  'anime':                  'digital_illustration',
  'cottagecore':            'realistic_image/natural_light',
  'haunted-mundane':        'realistic_image/hard_flash',
  '1990s-cgi':              'digital_illustration/handmade_3d',
  'botanical-illustration': 'digital_illustration/engraving_color',
  'brutalist-architecture': 'realistic_image/enterprise',
  'risograph-print':        'digital_illustration/grain',
}

// [LAW:one-source-of-truth] Pinned Recraft V3 version. Pinning buys reproducibility;
// model rotation becomes a visible diff.
const RECRAFT_MODEL_VERSION = '9507e61ddace8b3a238371b17a61be203747c5081ea6070fecd3c40d27318922'

// Recraft returns `output: string` (a single URL), same shape as Ideogram.
const succeededOutputSchema = z.string().url()

export function parseReplicateRecraftResponse(
  data: unknown,
  opts: { alt: string; w: number; h: number },
): Media {
  const prediction = predictionSchema.parse(data)
  if (prediction.status !== 'succeeded') {
    const err = typeof prediction.error === 'string' ? prediction.error : JSON.stringify(prediction.error ?? null)
    throw new Error(`Replicate prediction ${prediction.id} not succeeded: status=${prediction.status} error=${err}`)
  }
  const url = succeededOutputSchema.parse(prediction.output)
  return { kind: "image", url, w: opts.w, h: opts.h, alt: opts.alt }
}

export const replicateRecraft: GenerationProvider<Params> = {
  id: ProviderId("replicate-recraft"),
  kind: 'real',
  version: "2026-06-12",
  displayName: "Replicate Recraft V3",
  paramsSchema: params,
  capabilities: { producesMedia: ["image"], supportsSeed: true, costEstimateUsd: 0.04 },
  supportedAspectRatios: ASPECT_RATIOS,
  promptMaxLength: 1000,
  defaultParamsForRecipe({ prompt, styleFamily, seed }): Params {
    return {
      prompt,
      style: STYLE_TO_RECRAFT_STYLE[styleFamily],
      seed,
    }
  },
  async generate({ params: p, aspectRatio }, { env }): Promise<Media> {
    const { w, h } = RECRAFT_DIMS[aspectRatio]
    const input = {
      prompt: p.prompt,
      aspect_ratio: RECRAFT_ASPECT_RATIO[aspectRatio],
      ...(p.style !== undefined ? { style: p.style } : {}),
      ...(p.seed !== undefined ? { seed: p.seed } : {}),
    }
    try {
      const initial = await createPrediction({
        version: RECRAFT_MODEL_VERSION,
        input,
        token: env.SLOPSPOT_REPLICATE_API_KEY,
      })
      const terminal = await pollPrediction(initial, env.SLOPSPOT_REPLICATE_API_KEY)
      const result = parseReplicateRecraftResponse(terminal, { alt: p.prompt, w, h })
      emitAccountHealth('replicate', { status: 'ok' })
      return result
    } catch (err) {
      emitAccountHealth('replicate', classifyReplicateHealth(err))
      throw err
    }
  },
}
