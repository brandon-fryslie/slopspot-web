// [LAW:locality-or-seam] The verse "provider" — a GenerationProvider that wraps
// the composer-authored poem as text Media. No external API call: the poem is
// authored by the composer (callHaiku, composePrompt with medium='verse') and
// arrives in params.prompt. This provider's generate() is the single place where
// composer output becomes a text Media slop — same pipeline as image providers,
// zero special-casing in createPost. (slopspot-beyond-image-poj.1)

import { z } from 'zod'
import { ProviderId } from '~/lib/domain'
import { ASPECT_RATIOS } from '~/lib/variety'
import type { GenerationProvider } from './types'

const params = z.object({
  // The full poem text, authored by composePrompt (medium='verse'). The
  // provider wraps it as text Media — no transformation.
  prompt: z.string().min(1),
})
type Params = z.infer<typeof params>

// [LAW:types-are-the-program] The verse provider has no external API and no
// aspect-ratio semantics — the poem is the output, not a rendered image. All
// aspect ratios are declared supported so the chooser can assign any frame
// value to the recipe; the frame is stored as genome metadata but ignored
// by generate(). [LAW:dataflow-not-control-flow] generate() runs the same path
// regardless of frame — the data (params.prompt) decides the output.
export const verseProvider: GenerationProvider<Params> = {
  id: ProviderId('verse'),
  version: '1',
  displayName: 'Verse',
  kind: 'real',
  paramsSchema: params,
  capabilities: {
    producesMedia: ['text'],
    supportsSeed: false,
    // [LAW:one-source-of-truth] The Haiku API cost is incurred by composePrompt
    // (the composer, not this provider). The provider itself makes no API call,
    // so its marginal cost is 0. The composer's Haiku cost is tracked separately
    // via the slopspot.composer.result metric.
    costEstimateUsd: 0,
  },
  // All aspect ratios supported — aspect ratio is irrelevant to verse but the
  // recipe still carries a frame value (genome metadata). The chooser needs a
  // non-empty set; all five is the honest declaration for "no restriction."
  supportedAspectRatios: ASPECT_RATIOS,
  // No promptMaxLength: verse has no provider-side length constraint.
  defaultParamsForRecipe: () => ({ prompt: '' }),
  generate: ({ params: { prompt } }) => Promise.resolve({ kind: 'text', body: prompt }),
}
