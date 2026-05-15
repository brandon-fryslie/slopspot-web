import type { ProviderId } from '@/domain'
import type { GenerationProvider } from './types'

// [LAW:no-shared-mutable-globals] exception: this is a registry with a single owner
// (this module), an explicit API, and one invariant — register-once. Reading is free;
// writing only happens at module-load time when provider files self-register.
// [LAW:single-enforcer] Every "look up a provider by id" goes through here. No other
// module is allowed to switch on providerId.

const providers = new Map<ProviderId, GenerationProvider<unknown>>()

export function registerProvider<P>(provider: GenerationProvider<P>): void {
  if (providers.has(provider.id)) {
    throw new Error(`Provider already registered: ${provider.id}`)
  }
  providers.set(provider.id, provider as unknown as GenerationProvider<unknown>)
}

export function getProvider(id: ProviderId): GenerationProvider<unknown> {
  const p = providers.get(id)
  if (!p) throw new Error(`Unknown provider: ${id}`)
  return p
}

export function listProviders(): readonly GenerationProvider<unknown>[] {
  return [...providers.values()]
}
