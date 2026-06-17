// The breeding room's failure contract — breed's sibling of the Well's failure
// voice. The breed flow is a human-initiated
// generation, the same family of surface as the wishing well, and like the well its
// whole job is the spell: a leaked HTTP status / JSON envelope / JS error string
// shatters it. So a breed that cannot complete PAUSES, and the visitor hears the
// breeding room's voice — never a stack trace.
//
// [LAW:no-silent-fallbacks] A pause is loud, not swallowed: the breed stops and SAYS
// so. "Honest" does not mean "leak the envelope to the human" — the raw status + body
// stay in the console; the human hears the voice. Forking with the raw human prompt
// (violating the AI-authored invariant) or silently substituting a template (a true
// silent fallback) are both forbidden; the only honest move when the muse is down is
// to pause and tell the visitor.
//
// [LAW:one-type-per-behavior] The Well already maps a failure → a user-facing voice
// line with the raw detail kept in the console. Breed shares that DISCIPLINE but not
// the SHAPE: breed has two phases (rewrite, then fork) and non-HTTP failures (the
// rewrite stream can end without a usable prompt), so its failure domain is richer
// than the well's flat status→line. A reason union is the strongest true theorem here;
// stretching the well's status-table to cover the phase + empty-output cases would be
// the wrong-abstraction-by-stretching the laws warn against.
//
// Lives with NO server runtime deps (the same client/server discipline as the other
// client-safe lib modules) so the fork page can import it into the client bundle
// without dragging server code along.

import type { ForkErrorCause } from "~/lib/fork-error"

// [LAW:one-source-of-truth] The closed set of pause reasons lives here ONCE, as a
// runtime tuple, and the `BreedPause` type is DERIVED from it. The reason set is needed
// at two boundaries — the type level (exhaustive headline switches) and the runtime
// level (the /api/metrics/fork-pause beacon validates an incoming reason against this
// exact set). Deriving the type from the tuple means a new reason is added in one place
// and both boundaries catch up; a second hand-kept list could drift from the first.
export const BREED_PAUSE_REASONS = [
  // The rewrite phase failed: the citizen who silently re-authors the wish (the muse)
  // could not be reached. Any failure of that phase means the same thing to the
  // visitor — the spirit is quiet — regardless of the exact upstream status.
  'muse-unreachable',
  // The rewrite phase responded but yielded no usable prompt (no delimiter, or an
  // empty prompt after trimming). The muse spoke but said nothing to breed from.
  'muse-empty',
  // The fork phase hit the daily spend cap (429) — a user-reachable budget failure,
  // and the "out of money" axis the breed bug was first suspected to be.
  'out-of-budget',
  // The fork phase reached the city but the image forge upstream failed (502) — the
  // provider call threw or the upstream returned non-2xx. Transient; try again.
  'provider-unreachable',
  // The fork phase could not consult the spend ledger at all (503) — the budget check
  // itself was unavailable, distinct from being over budget. Transient; try again.
  'budget-unavailable',
  // The chosen provider rejected the request shape, or is not available in this
  // environment — actionable by the visitor: pick another provider/ratio. Both the
  // `invalid-params` and `provider-unavailable` causes select this reason because their
  // remedy genuinely coincides ("pick a different provider"); the SIGNAL distinguishing
  // them stays unambiguous (the cause), the visitor advice is the same. [LAW:dataflow-not-control-flow]
  'provider-rejected',
  // A deterministic server-side fault the route reported via the `internal` cause (a bug /
  // R2 / D1 failure). Distinct from `provider-unreachable` precisely so the visitor is NOT
  // told "the forge hit a snag; try again" when retrying cannot help — the honest line is
  // that the fault is ours and logged. [LAW:no-silent-failure]
  'internal-error',
  // An unexpected failure with NO usable server signal: a true network failure (no
  // response reached us), a response carrying no known cause, or an unexpected client-side
  // throw. The technical detail goes to the console, never to the visitor.
  'unknown',
] as const

export type BreedPauseReason = (typeof BREED_PAUSE_REASONS)[number]

// [LAW:types-are-the-program] The fork/breed page's error state is `BreedPause | null` —
// there is no field on this type that can hold an upstream status code or body, so the
// old `rewrite failed: 502 {…}` leak is impossible BY THE TYPE, not by discipline.
//
// Distributive mapped type: derives a DISCRIMINATED UNION (`{reason:'a'} | {reason:'b'} | …`)
// from the single-source tuple, rather than the flat `{reason: BreedPauseReason}`. The
// distinction is load-bearing: only the union collapses `pause` to `never` once every arm
// of an exhaustive `switch` is handled, so the `const _: never = pause` guard in
// pauseHeadline/breedPauseVoice fails to compile the moment a reason is added without copy.
export type BreedPause = {
  readonly [R in BreedPauseReason]: { readonly reason: R }
}[BreedPauseReason]

// [LAW:dataflow-not-control-flow] A fork/breed failure's machine-readable CAUSE selects the
// pause reason from a data table. The cause is the unambiguous signal the route emits (one
// cause = one failure mode), so this is a TOTAL function over the closed `ForkErrorCause`
// union — `Record<ForkErrorCause, …>` makes a missing cause a compile error, so a new cause
// cannot be added without deciding its reason here. The old status-keyed table is gone: a
// status like 502 / 422 meant several causes, which is exactly the conflation this fixes.
const PAUSE_BY_CAUSE: Record<ForkErrorCause, BreedPauseReason> = {
  'budget-exhausted': 'out-of-budget',
  'budget-unavailable': 'budget-unavailable',
  // Remedy coincides ("pick a different provider/ratio") — same reason, distinct causes.
  'provider-unavailable': 'provider-rejected',
  'invalid-params': 'provider-rejected',
  'provider-upstream': 'provider-unreachable',
  // The deterministic server fault — never voiced as a transient "try again". [LAW:no-silent-failure]
  'internal': 'internal-error',
  // Both 404 causes stay the quiet `unknown`: telling a visitor whose parent was deleted to
  // "pick a different provider" would be a misleading lie, and an unregistered-provider id is
  // a crafted request the UI never produces. A more specific "that slop is gone" reason is a
  // future refinement; the signal is now unambiguous, so it can be added without guessing.
  'parent-not-found': 'unknown',
  'provider-not-registered': 'unknown',
}

// [LAW:single-enforcer] The one mapping from a fork/breed failure CAUSE to a pause. The
// fork/breed page parses the cause out of the error body (parseForkErrorCause) and calls this;
// a `null` cause — no response reached us, or no known cause in the body — is the quiet
// `unknown`, never a guessed reason.
export function forkPause(cause: ForkErrorCause | null): BreedPause {
  return { reason: cause === null ? 'unknown' : PAUSE_BY_CAUSE[cause] }
}
