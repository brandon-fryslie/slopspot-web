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
  // The chosen provider rejected the request shape (422 — unsupported params / aspect
  // ratio, or the provider not being available in this environment) — actionable by the
  // visitor: pick another provider. NOTE 404 is deliberately NOT mapped here: both routes
  // overload 404 across "post/mate not found" (a stale or deleted parent — the dominant
  // case) AND "provider not registered", so the status alone cannot mean provider-rejected
  // without misleading the far more common not-found case; an unmapped 404 reads as the
  // honest `unknown`. [LAW:dataflow-not-control-flow]
  'provider-rejected',
  // An unexpected failure. The technical detail goes to the console (for diagnosis),
  // never to the visitor — this reason carries no detail precisely so it cannot.
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

// [LAW:dataflow-not-control-flow] The fork phase's HTTP status SELECTS a pause reason
// from a data table — the same idiom as the well's status-keyed voice table. A new
// status→reason pairing is one entry here, never a new branch at the call site; any
// status without an entry is the quiet `unknown`.
const FORK_PAUSE_BY_STATUS: Record<number, BreedPauseReason> = {
  422: 'provider-rejected',
  429: 'out-of-budget',
  502: 'provider-unreachable',
  503: 'budget-unavailable',
}

// [LAW:single-enforcer] The one mapping from a failed fork response to a pause. The
// fork page calls this with the response status; the status is read here, never shown.
export function forkPause(status: number): BreedPause {
  return { reason: FORK_PAUSE_BY_STATUS[status] ?? 'unknown' }
}
