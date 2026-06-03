// The runtime home for TraitVector's L1 concerns: the neutral genome + the storage-boundary
// parser. The STEERING SEMANTICS (how each axis becomes prompt bias) deliberately do NOT live
// here — they live in ONE place, the composer's trait→bias translation (L2). [LAW:single-enforcer]

import { z } from 'zod'
import type { TraitVector } from '~/lib/domain'

// [LAW:one-source-of-truth] The neutral genome — every axis at 0.5. New founders (the firehose)
// start here; drift (L3) moves them; a single child (fork) inherits its parent's. The migration
// column DEFAULT mirrors this value purely as backfill scaffolding; this is the runtime source
// for new writes.
export const NEUTRAL_TRAITS: TraitVector = {
  austerity: 0.5,
  curse: 0.5,
  density: 0.5,
  earnestness: 0.5,
}

// [LAW:types-are-the-program] The storage-boundary parser for traits_json. Exactly the four
// locked axes; an extra/missing key or a non-number fails loud at read, never laundered (the
// same discipline the variety enum parses use). Range [0,1] is NOT enforced here in L1 — nothing
// produces out-of-range yet; the lever that writes non-neutral traits arrives in L2/L3 and owns
// its own bounds.
export const traitVectorSchema: z.ZodType<TraitVector> = z.object({
  austerity: z.number(),
  curse: z.number(),
  density: z.number(),
  earnestness: z.number(),
})
