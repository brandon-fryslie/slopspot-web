import type { z } from 'zod'
import type { Media, ProviderId } from '@/domain'

export type GenerationCapabilities = {
  producesMedia: Media['kind'][]
  supportsSeed: boolean
}

// [LAW:locality-or-seam] The plugin contract. Adding a new provider is one new file
// implementing this interface. Removing one is one deletion. No core code special-cases
// providers — it asks the registry.
export interface GenerationProvider<P> {
  readonly id: ProviderId
  readonly version: string
  readonly displayName: string
  readonly paramsSchema: z.ZodType<P>
  readonly capabilities: GenerationCapabilities
  generate(params: P): Promise<Media>
}
