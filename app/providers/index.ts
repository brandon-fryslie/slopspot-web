// Importing this module registers every provider as a side effect. Anywhere that needs
// the registry populated should import from here, not from './registry' directly.
import { registerProvider } from './registry'
import { falFluxMock } from './fal-flux-mock'
import { replicateSdxlMock } from './replicate-sdxl-mock'
import { replicateIdeogramMock } from './replicate-ideogram-mock'
import { falFlux } from './fal-flux'
import { replicateSdxl } from './replicate-sdxl'
import { replicateIdeogram } from './replicate-ideogram'

registerProvider(falFlux)
registerProvider(falFluxMock)
registerProvider(replicateSdxl)
registerProvider(replicateSdxlMock)
registerProvider(replicateIdeogram)
registerProvider(replicateIdeogramMock)

export { getProvider, listProviders, realProviders, UnknownProviderError } from './registry'
export type { GenerationProvider, GenerationCapabilities } from './types'
