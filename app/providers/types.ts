import type { z } from "zod"
import type { Media, ProviderId } from "~/lib/domain"

export type GenerationCapabilities = {
  producesMedia: Media["kind"][]
  supportsSeed: boolean
}

// [LAW:single-enforcer] The env binding flows in here. Providers that need
// secrets read them from context.env (typed by wrangler types from
// wrangler.jsonc + .dev.vars). Mocks ignore context entirely. The provider
// stays a pure singleton object; no factory closures, no module-level state.
export type GenerationContext = {
  env: Env
}

// [LAW:locality-or-seam] The plugin contract. Adding a new provider is one new
// file implementing this interface. Removing one is one deletion. No core code
// special-cases providers — it asks the registry.
export interface GenerationProvider<P> {
  readonly id: ProviderId
  readonly version: string
  readonly displayName: string
  readonly paramsSchema: z.ZodType<P>
  readonly capabilities: GenerationCapabilities
  generate(params: P, context: GenerationContext): Promise<Media>
}
