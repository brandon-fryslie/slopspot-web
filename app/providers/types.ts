import type { z } from "zod"
import type { AspectRatio, Media, ProviderId, StyleFamily } from "~/lib/domain"

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
// [LAW:locality-or-seam] What the chooser hands to a provider to construct
// sensible default params for a recipe — the *recipe* fields the chooser is
// committed to, not the provider's already-known concerns.
//
// `seed` is a deterministic 32-bit unsigned int derived from the chooser's
// own hash of (scheduledTime, 'params'). Providers that support seeding
// (sdxl, ideogram) use it for reproducibility; providers that don't (fal-flux
// schnell) ignore it.
export type RecipeBuilderInput = {
  prompt: string
  styleFamily: StyleFamily
  seed: number
  // [LAW:decomposition] Whether this draw is an EMBALMED RELIC — the Wishing
  // Well's signature output, where the muse re-authors a wish into a preserved
  // specimen (skeleton/taxidermy/fossil). A provider that supports negative
  // prompts steers its render away from the three known embalm-render failures
  // (a live creature, a substituted human skeleton, a promoted second creature)
  // ONLY when this is true. The provider needs to know "embalmed relic: yes/no",
  // NOT the occasion taxonomy that produced it — the wish/breed/firehose
  // distinction stays upstream in generator.ts. [LAW:dataflow-not-control-flow]
  // the steering is a VALUE that flows through this seam, not a branch the
  // provider takes; REQUIRED (not optional) so "forgot to decide" is
  // unrepresentable rather than a silent false. [LAW:single-enforcer] the canonical
  // recipe carries only this boolean — the negative TEXT is each provider's own
  // native translation, like its aspect-ratio map.
  embalmedRelic: boolean
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
//
// `defaultParamsForRecipe` builds the provider's own params shape from
// canonical recipe fields. The chooser knows about style/prompt; the provider
// knows about its native params — this method is the seam where those meet.
// [LAW:locality-or-seam] per-provider knowledge stays in the provider file;
// the chooser is a pure orchestrator with zero switch-on-providerId.
export interface GenerationProvider<P> {
  readonly id: ProviderId
  readonly version: string
  readonly displayName: string
  // [LAW:types-are-the-program] Provider kind discriminates "real" providers
  // (paid API call, real model output) from "mock" providers (free local-dev
  // stub, deterministic placeholder image). The firehose chooser filters by
  // kind so prod never picks a mock; getProvider remains unfiltered so legacy
  // stored posts with mock providerIds still render. Without this field,
  // listProviders() would have to compare against a hardcoded list of mock
  // ids, scattering the real-vs-mock discriminator across the codebase.
  readonly kind: 'real' | 'mock'
  readonly paramsSchema: z.ZodType<P>
  readonly capabilities: GenerationCapabilities
  readonly supportedAspectRatios: readonly AspectRatio[]
  // [LAW:one-source-of-truth] The provider's authoritative upper bound on
  // prompt length. paramsSchema enforces this at the trust boundary; this
  // field exposes it for UI affordances that need to know the bound *before*
  // a submission round-trip (e.g. the fork form's textarea maxLength). Drift
  // between this number and paramsSchema's max would mean the form lets
  // users type something the schema then rejects — keep them aligned at the
  // declaration site. Optional: providers that produce non-prompt media
  // (e.g. verse) have no provider-side length constraint.
  readonly promptMaxLength?: number
  defaultParamsForRecipe(input: RecipeBuilderInput): P
  generate(input: GenerationInput<P>, context: GenerationContext): Promise<Media>
}
