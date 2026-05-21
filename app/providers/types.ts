import type { z } from "zod"
import type { Media, ProviderId } from "~/lib/domain"

export type GenerationCapabilities = {
  producesMedia: Media["kind"][]
  supportsSeed: boolean
  // Estimated USD per generate() call. The firehose budget guard sums this
  // across calls in a window to enforce a daily spend ceiling; the registry is
  // the single source of truth for what a provider costs. Mocks are 0 (free).
  costEstimateUsd: number
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
