import { z } from 'zod'
import { ProviderId, type Media } from '@/domain'
import type { GenerationProvider } from './types'

// fal.ai FLUX shape: prompt + categorical aspect ratio + integer step count.
// No seed support. Mock implementation returns a deterministic picsum URL.
const params = z.object({
  prompt: z.string().min(1).max(500),
  aspectRatio: z.enum(['1:1', '16:9', '9:16']),
  steps: z.number().int().min(1).max(50),
})
type Params = z.infer<typeof params>

const dims: Record<Params['aspectRatio'], { w: number; h: number }> = {
  '1:1': { w: 1024, h: 1024 },
  '16:9': { w: 1280, h: 720 },
  '9:16': { w: 720, h: 1280 },
}

export const falFluxMock: GenerationProvider<Params> = {
  id: ProviderId('fal-flux-mock'),
  version: '2026-05-15',
  displayName: 'fal.ai FLUX (mock)',
  paramsSchema: params,
  capabilities: { producesMedia: ['image'], supportsSeed: false },
  async generate(p): Promise<Media> {
    const { w, h } = dims[p.aspectRatio]
    const seed = encodeURIComponent(p.prompt).slice(0, 64)
    return { kind: 'image', url: `https://picsum.photos/seed/${seed}/${w}/${h}`, w, h, alt: p.prompt }
  },
}
