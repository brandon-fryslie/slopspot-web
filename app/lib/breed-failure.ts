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

// [LAW:types-are-the-program] The closed set of reasons a breed can pause for. Each
// arm is one honest headline; "paused for no reason" and "a raw HTTP status as the
// reason" are both unrepresentable. The fork page's error state is `BreedPause | null`
// — there is no field on this type that can hold an upstream status code or body, so
// the old `rewrite failed: 502 {…}` leak is impossible BY THE TYPE, not by discipline.
export type BreedPause =
  // The rewrite phase failed: the citizen who silently re-authors the wish (the muse)
  // could not be reached. Any failure of that phase means the same thing to the
  // visitor — the spirit is quiet — regardless of the exact upstream status.
  | { readonly reason: 'muse-unreachable' }
  // The rewrite phase responded but yielded no usable prompt (no delimiter, or an
  // empty prompt after trimming). The muse spoke but said nothing to breed from.
  | { readonly reason: 'muse-empty' }
  // The fork phase hit the daily spend cap — the one user-reachable budget failure,
  // and the "out of money" axis the breed bug was first suspected to be.
  | { readonly reason: 'out-of-budget' }
  // An unexpected failure. The technical detail goes to the console (for diagnosis),
  // never to the visitor — this arm carries no detail field precisely so it cannot.
  | { readonly reason: 'unknown' }

// [LAW:dataflow-not-control-flow] The fork phase's HTTP status SELECTS a pause reason
// from a data table — the same idiom as the well's status-keyed voice table. A new
// status→reason pairing is one entry here, never a new branch at the call site; any
// status without an entry is the quiet `unknown`.
const FORK_PAUSE_BY_STATUS: Record<number, BreedPause['reason']> = {
  429: 'out-of-budget',
}

// [LAW:single-enforcer] The one mapping from a failed fork response to a pause. The
// fork page calls this with the response status; the status is read here, never shown.
export function forkPause(status: number): BreedPause {
  return { reason: FORK_PAUSE_BY_STATUS[status] ?? 'unknown' }
}
