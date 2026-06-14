// Importing this module registers every provider as a side effect. Anywhere that needs
// the registry populated should import from here, not from './registry' directly.
import { registerProvider } from './registry'
import { falFluxMock } from './fal-flux-mock'
import { falFluxDevMock } from './fal-flux-dev-mock'
import { replicateSdxlMock } from './replicate-sdxl-mock'
import { replicateIdeogramMock } from './replicate-ideogram-mock'
import { replicateRecraftMock } from './replicate-recraft-mock'
import { openAIDalleMock } from './openai-dalle-mock'
import { falFlux } from './fal-flux'
import { falFluxDev } from './fal-flux-dev'
import { replicateSdxl } from './replicate-sdxl'
import { replicateIdeogram } from './replicate-ideogram'
import { replicateRecraft } from './replicate-recraft'
import { openAIDalle } from './openai-dalle'
import { verseProvider } from './verse'

registerProvider(falFlux)
registerProvider(falFluxMock)
registerProvider(falFluxDev)
registerProvider(falFluxDevMock)
registerProvider(replicateSdxl)
registerProvider(replicateSdxlMock)
registerProvider(replicateIdeogram)
registerProvider(replicateIdeogramMock)
registerProvider(replicateRecraft)
registerProvider(replicateRecraftMock)
registerProvider(openAIDalle)
registerProvider(openAIDalleMock)
registerProvider(verseProvider)

export { getProvider, listProviders, mediumOf, realProviders, UnknownProviderError } from './registry'
export type { CityMedium } from './registry'
export type { GenerationProvider, GenerationCapabilities } from './types'
