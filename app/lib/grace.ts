// [LAW:make-it-impossible] The Patronage's grace runs the social graph the OTHER way — a citizen,
// corpus-derived and unexplained, chooses a human (slopspot-patronage-ts7.8). This module is the PURE
// CORE of that choice, and the load-bearing invariant lives in its TYPE: `GraceCorpus` carries ONLY the
// engagement relation (a human engaged a citizen's made-thing). There is NO field a backing could flow
// through — so "grace reads the prayer (the backings table)" is not merely forbidden by a guard, it is
// UNREPRESENTABLE in the fold's input. The orthogonality test (ts7.4's shape, mirrored for grace) then
// proves the I/O boundary that BUILDS this corpus does not smuggle a backing in either: the type closes
// the pure half, the test closes the impure half.
//
// [LAW:one-way-deps] Pure leaf over hash + the domain id brands. No I/O, no clock, no db, no backings —
// the same discipline as lib/rite.ts (the Rite's pure election) and chooseNextGeneration (the firehose
// fold). The db boundary (db/grace.ts) builds a GraceCorpus and folds it here; the orchestrator
// (agents/grace.ts) sources the rarity value and records the result.

import { seedFloat, seedHash } from '~/lib/hash'
import type { AgentId, PostId } from '~/lib/domain'

// [LAW:types-are-the-program] ONE engagement edge: a human engaged a citizen's made-thing. This is the
// WHOLE relation grace folds — `citizen` is the maker who authored the slop, `human` is the anon voter
// who engaged it, `postId` is the made-thing the choice attaches to. Votes ⋈ authorship; never backings.
// The chosen grace IS one of these edges (so there is no separate "choice" type — [LAW:one-type-per-behavior]):
// the fold returns the edge it picked.
export type GraceEdge = {
  readonly citizen: AgentId
  readonly human: string
  readonly postId: PostId
}

// [LAW:types-are-the-program] The corpus the chooser folds — the eligible engagement edges and NOTHING
// ELSE. A backing has no home here. Wrapped in an object (not a bare array) so a later corpus signal the
// fold may read (an utterance trail, a verdict history) extends the type without reshaping every caller —
// but a `backings` field is a contradiction this type's whole purpose forbids.
export type GraceCorpus = {
  readonly edges: readonly GraceEdge[]
}

// The default rate at which grace falls per daily pass, given a non-empty corpus — a VALUE, not a mode.
// Grace is rare and useless by design; the CD tunes the live value on the Proprietor's persona config
// (graceFallRate) with no redeploy, and this constant is the floor the orchestrator uses when it is unset.
// ~1-in-30 days makes grace a roughly monthly event the city can actually witness without it being common.
export const DEFAULT_GRACE_FALL_RATE = 1 / 30

// [LAW:dataflow-not-control-flow] The fold: a deterministic function of (corpus, scheduledTime, rarity).
// Two degenerate states resolve to a real value (null), never a skipped operation: an empty corpus (no
// eligible edge — the orchestrator reads this as `barren`) and the rarity gate not opening this pass (the
// common case — `withheld`). When grace DOES fall, it is a UNIFORM hash-pick over the eligible edges —
// corpus-derived and unexplained, NOT a merit rank: there is no ordering by score, backing, or devotion. A
// human present in more edges (engaged more of a citizen's work) is gently more likely, an EMERGENT "the
// one who keeps returning," never an earned leaderboard. Same (corpus, scheduledTime, rarity) → same edge,
// the reproducible-pick discipline of pickPersona and the firehose chooser (FNV-1a via lib/hash).
//
// [LAW:no-defensive-null-guards] `rarity` is a [0,1] value the orchestrator already clamps; this reads it
// straight. The returned edge is one of `corpus.edges` by construction (idx is bounded by length).
export function chooseGrace(
  corpus: GraceCorpus,
  scheduledTimeMs: number,
  rarity: number,
): GraceEdge | null {
  if (corpus.edges.length === 0) return null
  if (seedFloat(scheduledTimeMs, 'grace', 'falls') >= rarity) return null
  const idx = seedHash(scheduledTimeMs, 'grace', 'choose') % corpus.edges.length
  return corpus.edges[idx]
}
