import type { ProviderId } from "~/lib/domain"
import type { GenerationProvider } from "./types"

// [LAW:no-shared-mutable-globals] exception: this is a registry with a single owner
// (this module), an explicit API, and one invariant — register-once. Reading is free;
// writing only happens at module-load time when provider files self-register.
// [LAW:single-enforcer] Every "look up a provider by id" goes through here. No other
// module is allowed to switch on providerId.

// [LAW:single-enforcer] "Unknown provider" is the registry's failure to own as a
// type, not a generic Error every caller has to string-match. Callers that map
// failures (e.g. the /api/generate HTTP boundary) discriminate on this class.
export class UnknownProviderError extends Error {
  constructor(readonly providerId: ProviderId) {
    super(`Unknown provider: ${providerId}`)
    this.name = "UnknownProviderError"
  }
}

const providers = new Map<ProviderId, GenerationProvider<unknown>>()

export function registerProvider<P>(provider: GenerationProvider<P>): void {
  if (providers.has(provider.id)) {
    throw new Error(`Provider already registered: ${provider.id}`)
  }
  providers.set(provider.id, provider as unknown as GenerationProvider<unknown>)
}

export function getProvider(id: ProviderId): GenerationProvider<unknown> {
  const p = providers.get(id)
  if (!p) throw new UnknownProviderError(id)
  return p
}

export function listProviders(): readonly GenerationProvider<unknown>[] {
  return [...providers.values()]
}

// [LAW:single-enforcer] The one place "which providers may be PICKED by the
// firehose for new generations" is decided. listProviders() stays unfiltered
// (so getProvider(id) still works for legacy stored posts whose providerId
// is a mock — the renderer must remain able to look those up); this accessor
// filters by kind based on the environment.
//
// [LAW:dataflow-not-control-flow] The env's SLOPSPOT_ENV value is the
// discriminator; the function always runs the same filter. There is no
// "if prod, skip mocks; else, don't filter" branch scattered across callers
// — the data picks the variant here, once.
//
// [LAW:types-are-the-program] Returning a readonly array of the same element
// type as listProviders() means callers can swap one for the other with no
// other changes. The firehose chooser doesn't know or care that this
// filtered call exists; it just receives a smaller list in prod.
export function realProviders(env: Env): readonly GenerationProvider<unknown>[] {
  const isProd = env.SLOPSPOT_ENV === 'prod'
  return [...providers.values()].filter((p) => !isProd || p.kind === 'real')
}
