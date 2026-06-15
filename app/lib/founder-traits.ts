// [LAW:single-enforcer] The ONE place a FOUNDER genome's trait vector is sampled. `founder`
// reproduction (the firehose seeds a fresh bloodline through a generator persona) gets its register
// HERE; `bred` (two parents, app/firehose/breed.ts) recombines its parents', and `single` (fork)
// inherits its one parent's. Three reproduction modes, three trait sources — this is the founder's.
//
// WHY THIS EXISTS (slopspot-genome-fby): founders were born at flat NEUTRAL_TRAITS, so the whole
// gene pool clustered at the 0.5 mean and the composer's traitBias steered every slop onto the same
// 'baroque maximalism' voice — an aesthetic monoculture across varying style families. Selection
// breeds winners but nothing injected SPREAD at birth. This sampler is that injection: a founder is
// born scattered around its author-citizen's declared sensibility instead of pinned to neutral.
//
// [LAW:one-source-of-truth] The CENTER is the persona's OWN traits column (personas.traits) — the
// citizen's single sensibility vector, the SAME one lib/register projects to a speech/image steer.
// Migration 0030 mandated this exact wiring ("when the persona→image-composition wiring lands it
// MUST read THIS column for the generate register — never invent a second persona-style source").
// So there is no new config key and no second leaning field: a citizen's taste in trait-space is
// already named once, and founder births read it. A neutral citizen (every axis 0.5 — the column
// default) births NEUTRAL JITTER; a citizen CD has tuned toward a region births PULLED toward it.
//
// [LAW:no-ambient-temporal-coupling] Pure leaf above `domain` (types) and `hash` (determinism): no
// env, no I/O, NO CLOCK. The seed is passed in — the firehose hands its scheduledTime — so the same
// fire replays the same founder, the reproducibility discipline pickPersona / chooseNextGeneration
// already hold. Math.random()/Date.now() would break replay and are banned; this samples from the
// seed instead.

import type { TraitVector } from '~/lib/domain'
import { seedFloat } from '~/lib/hash'

// [LAW:no-defensive-null-guards] clamp01 CONSTRUCTS an in-[0,1] value, the same way breed.ts's does:
// a jitter can push a near-pole center past the [0,1] lock, and clamping is how the sampled trait is
// MADE legal — not a guard bolted on after. L1's strict traitVectorSchema is the read-proof boundary
// (a founder genome round-trips through it on the next read), so there is no re-validation here.
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

// [LAW:no-mode-explosion] The half-width of the founder birth scatter — the single knob, surfaced and
// tunable. WIDE on purpose: founders must SPREAD across the register space to break the 0.5-clustered
// monoculture, where breed's DRIFT_MAX (0.1) only nudges a child off the segment between its parents.
// Each axis samples uniform [center − SPREAD, center + SPREAD] then clamps, so a neutral center
// births uniform [0.1, 0.9] — a genuine spread, never the pinned 0.5 that made the gene pool one voice.
export const FOUNDER_TRAIT_SPREAD = 0.4

// [LAW:dataflow-not-control-flow] ONE expression applied to each axis name — variation lives in the
// sampled VALUE, never in a branch around an axis. The seed is dimension-tagged ('founder', axis) so
// the four axes scatter UNCORRELATED from one number (the same independent-avalanche discipline
// breed's mix/drift use), and uncorrelated from the recipe-choice and persona-pick streams that read
// the same scheduledTime under different tags — a citizen can be born more austere without dragging
// its density along. The persona's center is the only thing that biases the draw; everything else is
// the seed. [LAW:single-enforcer] one sampler, every founder axis.
export function founderTraits(center: TraitVector, seed: number): TraitVector {
  const sample = (axis: keyof TraitVector): number => {
    const jitter = (seedFloat(seed, 'founder', axis) - 0.5) * 2 * FOUNDER_TRAIT_SPREAD
    return clamp01(center[axis] + jitter)
  }
  return {
    austerity: sample('austerity'),
    curse: sample('curse'),
    density: sample('density'),
    earnestness: sample('earnestness'),
  }
}
