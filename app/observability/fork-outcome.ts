// [LAW:single-enforcer] The one place a COUNTED fork/breed outcome becomes an HTTP response. Both
// the api.fork and api.breed actions build every terminal result through here, so the
// slopspot.fork.outcome counter cannot drift from what the visitor actually received: there is no
// path that returns a fork/breed success or a cause without incrementing the matching series.
//
// [LAW:effects-at-boundaries] The metric (an effect) is emitted at the boundary where the outcome
// is decided — the route action — never reconstructed downstream. forkErrorResponse stays
// client-safe (it emits nothing) so the fork/breed pages can keep importing the cause parser into
// the browser bundle; this server-only wrapper layers the emission around it. emit() is the app's
// single metric enforcer, so the count flows through the same pipeline as every other app metric.
//
// Scope: an "outcome" is an attempt that reached the cause-bearing pipeline (parent lookup onward)
// and either succeeded or failed with a ForkErrorCause. Pre-attempt rejections — wrong method, a
// cross-origin POST, a malformed body, a non-generation parent — are NOT fork outcomes: they carry
// no cause and have no series here, made unrepresentable by the closed `ForkErrorCause | 'success'`
// label type. The success ratio is therefore "of attempts that tried", which is the honest reading.

import { emit } from "~/observability/metrics"
import { forkErrorResponse, type ForkErrorCause } from "~/lib/fork-error"

// Which human-initiated reproduction act the outcome belongs to — fork (single/asexual) or breed
// (sexual/two-parent). Mirrors the `surface` of slopspot.fork.pause so a dashboard can split or
// merge the two journeys. [LAW:one-type-per-behavior] the two surfaces share this counter's shape.
export type ForkSurface = "fork" | "breed"

// [LAW:dataflow-not-control-flow] Emit the failure outcome, then build its honest error response.
// Wraps forkErrorResponse so the cause→status pairing stays the single source of truth there; this
// adds only the count. The cause IS the outcome label — no separate failure vocabulary.
export function forkFailed(
  surface: ForkSurface,
  cause: ForkErrorCause,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  emit("slopspot.fork.outcome", { surface, outcome: cause }, 1)
  return forkErrorResponse(cause, message, extra)
}

// Emit the success outcome and pass the already-built success response through. The caller owns the
// success body and headers (the new post id, the set-cookie); this layers on only the counter.
export function forkSucceeded(surface: ForkSurface, response: Response): Response {
  emit("slopspot.fork.outcome", { surface, outcome: "success" }, 1)
  return response
}
