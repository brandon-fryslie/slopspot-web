import type { z } from "zod"
import type { AspectRatio, Media, ProviderId } from "~/lib/domain"

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

// [LAW:types-are-the-program] What the provider needs to execute a generation,
// in two named halves:
//
//   - `params: P`: provider-specific input, parsed by `paramsSchema`. Shape
//     varies per provider (FLUX has `steps`; SDXL has `negativePrompt` /
//     `guidanceScale` / `seed`). Required.
//   - `aspectRatio: AspectRatio`: canonical token, not provider-native. The
//     provider translates to its native shape (fal `image_size` enum, SDXL
//     explicit (w,h)) at its boundary. Lifted out of `paramsSchema` per the
//     variety design doc so one representation flows across all providers
//     and `Generation.aspectRatio` is the source of truth.
//
// Why a single `input` object instead of two positional args: future
// canonical-across-providers fields (e.g. seed) join the object; the call
// shape stays stable. GenerationContext stays orthogonal (runtime env only,
// no request data).
export type GenerationInput<P> = {
  params: P
  aspectRatio: AspectRatio
}

// [LAW:locality-or-seam] The plugin contract. Adding a new provider is one new
// file implementing this interface. Removing one is one deletion. No core code
// special-cases providers — it asks the registry.
//
// `supportedAspectRatios` declares which canonical aspect-ratio tokens this
// provider can serve. The chooser samples within `provider.supportedAspectRatios`
// so a provider can never receive a ratio it doesn't accept. Per [LAW:single-enforcer]
// this is the authoritative source — `paramsSchema` does not redundantly carry
// aspect-ratio constraints.
export interface GenerationProvider<P> {
  readonly id: ProviderId
  readonly version: string
  readonly displayName: string
  readonly paramsSchema: z.ZodType<P>
  readonly capabilities: GenerationCapabilities
  readonly supportedAspectRatios: readonly AspectRatio[]
  generate(input: GenerationInput<P>, context: GenerationContext): Promise<Media>
}
