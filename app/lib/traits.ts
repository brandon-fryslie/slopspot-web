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

// [LAW:types-are-the-program] The storage-boundary parser for traits_json — the strongest
// true theorem about a TraitVector: EXACTLY the four locked axes, each in [0,1].
// [LAW:no-silent-fallbacks] `.strict()` is load-bearing: plain z.object() would silently STRIP
// an unknown key, so a stale-migration or L2-write-bug `paletteBias`/`resolution` would be
// accepted-and-dropped instead of rejected — leaving the paletteBias-cut and resolution-
// reserved locks unenforced at the boundary. `.strict()` rejects it loud. The `.min(0).max(1)`
// per axis is the same re-validate-at-the-D1-boundary discipline the variety enum parses use:
// storage can lie (raw SQL could write `5.0`) even though L1 only ever writes the neutral 0.5,
// and this read boundary is where that lie must surface. An extra/missing key, a non-number,
// or an out-of-range value all fail loud here, never laundered. Same soul-rule as no-Media on
// the Genome: hold ONLY the legal axes, only their legal values.
export const traitVectorSchema: z.ZodType<TraitVector> = z
  .object({
    austerity: z.number().min(0).max(1),
    curse: z.number().min(0).max(1),
    density: z.number().min(0).max(1),
    earnestness: z.number().min(0).max(1),
  })
  .strict()

// [LAW:one-source-of-truth] The canonical ordered enumeration of the four axes. Code that must
// iterate the axes (the register projection, the trait-spread measurement, metric labels) reads
// THIS, never a re-declared `['austerity', ...]` literal that could drift from TraitVector's keys.
// `TraitAxis` is `keyof TraitVector` made nameable so a metric label or a cohort report can be
// typed to exactly the four axes — a typo'd axis is a compile error, same theorem as the schema.
export type TraitAxis = keyof TraitVector
export const TRAIT_AXES: readonly TraitAxis[] = ['austerity', 'curse', 'density', 'earnestness']
