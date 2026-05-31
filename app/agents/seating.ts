import { listPersonas, type Persona } from '~/agents/persona'

// The seating function — who catches a wish, i.e. which citizen authors the slop
// made in answer to it (design-docs/the-wishing-well.md; the-well-foundation.md
// item 6).
//
// The whole point of this module is that "who authors this slop" on the wish
// path is answered in exactly one place. v1's policy is weighted-random over the
// active citizens; the characterful policy (a citizen whose taste *clashes* with
// the wish catches it on purpose, for the friction — the-wishing-well.md §"Who
// hijacks you") evolves *inside* `selectSeat` without any caller learning the
// policy changed. The signature is the contract; the body is free to read
// anything later.

// The wish as the seating policy reads it. v1 reads nothing from it; the
// characterful policy will read the desire `text` to seat a clashing citizen.
// Kept to the minimal surface the policy may touch so the persisted wish
// (well-foundation .3) is a structural superset of this — there is no competing
// wish model. [LAW:one-source-of-truth]
export interface Wish {
  readonly text: string
}

// v1 weight: every active citizen is equally likely to catch a wish. The
// characterful policy replaces this with a wish-aware weight (taste-clash)
// computed from the persona and the wish — here, inside the seam, with no caller
// change. [LAW:dataflow-not-control-flow] the policy's variability becomes a
// weight *value*, never a branch over how the pick runs.
const seatWeight = (_persona: Persona, _wish: Wish): number => 1

// The seating policy core: weighted-random over the given (active) candidates.
//
// [LAW:single-enforcer] the one place the wish-path author is decided.
// [LAW:locality-or-seam] callers depend on this signature, never on the policy.
//
// Pure and RNG-injectable: the draw source is a parameter (default `Math.random`
// in prod, a deterministic stub in tests), so the weighting is machine-verifiable
// and there is no un-seedable randomness in the body. This is the wish-path's own
// selector, distinct from the firehose's hash-seeded `pickWeighted` (which is
// reproducible-by-scheduled-time, not rng-injectable) — one mechanism per path,
// no shared sampler to drift.
//
// Candidates are non-empty by type, so "nobody to seat" is unrepresentable in
// here — that optionality is resolved at the seam below, never defended against.
// [LAW:no-defensive-null-guards]
export function selectSeat(
  candidates: readonly [Persona, ...Persona[]],
  wish: Wish,
  rng: () => number = Math.random,
): Persona {
  const weights = candidates.map((p) => seatWeight(p, wish))
  const total = weights.reduce((sum, w) => sum + w, 0)
  const target = rng() * total
  // Cumulative-threshold scan: the inherent shape of weighted sampling, not
  // skipped work. The trailing return covers the floating-point edge where
  // `target` never strictly undershoots `total`.
  let acc = 0
  for (let i = 0; i < candidates.length; i++) {
    acc += weights[i]
    if (target < acc) return candidates[i]
  }
  return candidates[candidates.length - 1]
}

// The seating seam callers use: seat a citizen to answer this wish.
//
// [LAW:single-enforcer] every wish-born slop's author is decided here and nowhere
// else — callers never see the policy, so swapping it touches only this module.
//
// Delineated from `pickPersona` (app/agents/persona.ts): that owns the cron
// generator pick — deterministic by scheduled time, for reproducible fires. This
// owns the wish-answerer pick — weighted-random. One owner per path; no scattered
// randomness at call sites. (Both seat a generator persona; because the draw here
// is rng-injectable, the two could later collapse into one seam by injecting a
// time-seeded rng, without a caller rewrite.)
//
// The seated persona becomes the slop's author via the existing `AuthoredOrigin`
// (`{ author: PersonaActor }`, keyed by `agentId`) — there is no new author
// field. Returns null only when the city has no active citizen to answer — a real
// terminal state the caller (the Well endpoint, .8) handles, not a defensive skip.
// The optionality is genuine and lives at this DB trust boundary; it never leaks
// inward to `selectSeat`. [LAW:no-defensive-null-guards]
export async function seatCitizen(
  env: Env,
  wish: Wish,
  options?: { rng?: () => number },
): Promise<Persona | null> {
  const candidates = await listPersonas(env, 'generator')
  if (candidates.length === 0) return null
  const [first, ...rest] = candidates
  return selectSeat([first, ...rest], wish, options?.rng)
}
