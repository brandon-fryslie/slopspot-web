// Importing this module registers every provider as a side effect. Anywhere that needs
// the registry populated should import from here, not from './registry' directly.
import { registerProvider } from './registry'
import { falFluxMock } from './fal-flux-mock'
import { replicateSdxlMock } from './replicate-sdxl-mock'
import { falFlux } from './fal-flux'
import { replicateSdxl } from './replicate-sdxl'

registerProvider(falFlux)
registerProvider(falFluxMock)
registerProvider(replicateSdxl)
registerProvider(replicateSdxlMock)

export { getProvider, listProviders, UnknownProviderError } from './registry'
export type { GenerationProvider, GenerationCapabilities } from './types'
