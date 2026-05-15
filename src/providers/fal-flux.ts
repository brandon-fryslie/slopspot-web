import { fal } from '@fal-ai/client'
import { z } from 'zod'
import { ProviderId, type Media } from '@/domain'
import { getSecret } from '@/lib/secrets'
import type { GenerationProvider } from './types'

// Real fal.ai FLUX schnell provider. Same paramsSchema *shape* as fal-flux-mock
// (categorical aspectRatio + step count), with schnell's tighter step bound (1-4).
// The mock and the real provider intentionally share schema shape so seed posts
// and UI forms work against either by changing one providerId string.
const params = z.object({
  prompt: z.string().min(1).max(500),
  aspectRatio: z.enum(['1:1', '16:9', '9:16']),
  steps: z.number().int().min(1).max(4),
})
type Params = z.infer<typeof params>

const imageSize: Record<Params['aspectRatio'], 'square_hd' | 'landscape_16_9' | 'portrait_16_9'> = {
  '1:1': 'square_hd',
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
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

let configured = false
function ensureConfigured(): void {
  if (configured) return
  fal.config({ credentials: getSecret('slopspot-fal-api-key') })
  configured = true
}

export const falFlux: GenerationProvider<Params> = {
  id: ProviderId('fal-flux'),
  version: '2026-05-15',
  displayName: 'fal.ai FLUX schnell',
  paramsSchema: params,
  capabilities: { producesMedia: ['image'], supportsSeed: false },
  async generate(p): Promise<Media> {
    ensureConfigured()
    const result = await fal.run('fal-ai/flux/schnell', {
      input: {
        prompt: p.prompt,
        image_size: imageSize[p.aspectRatio],
        num_inference_steps: p.steps,
      },
    })
    const data = responseSchema.parse(result.data)
    const first = data.images[0]
    return {
      kind: 'image',
      url: first.url,
      w: first.width,
      h: first.height,
      alt: p.prompt,
    }
  },
}
