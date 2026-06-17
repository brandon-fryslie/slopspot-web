// The fork/breed error WIRE CONTRACT — the machine-readable cause a fork or breed
// route emits when it cannot complete, so the visitor-facing pause is selected from an
// UNAMBIGUOUS signal rather than an HTTP status that means several things.
//
// [LAW:dataflow-not-control-flow] An HTTP status is too weak a discriminator: 502 means
// both "the provider call failed upstream" (transient — retry is honest) AND "a deterministic
// server fault" (a bug / R2 / D1 failure — retry is a LIE), and 422 means both "provider not
// available in this environment" AND "the provider rejected the request shape". The CAUSE is
// the strong discriminator — one cause is exactly one failure mode — so the client maps it
// through a TOTAL table instead of re-deriving meaning by branching on a reused status.
//
// [LAW:one-source-of-truth] The closed cause set lives here ONCE, as a runtime tuple, with
// `ForkErrorCause` DERIVED from it. The cause set is needed at three boundaries — the routes
// (emit a cause + its honest status), the client (parse the cause back out of the body), and
// the cause→reason map (breed-failure.ts). A second hand-kept list could drift from the first.
//
// Lives with NO server runtime deps (the same client/server discipline as breed-failure.ts)
// so the fork/breed pages can import the parser into the client bundle without dragging server
// code along. `Response`/`Response.json` are web standards available in both the Worker and the
// browser, so the response builder here is universal, not a server dependency.

import { z } from "zod"

export const FORK_ERROR_CAUSES = [
  // The fork phase hit the daily spend cap (429). The "out of money" axis.
  "budget-exhausted",
  // The spend ledger could not be CONSULTED at all (503) — the budget check itself was
  // unavailable (a D1 read failure), distinct from being over budget. Transient.
  "budget-unavailable",
  // The chosen provider/medium is not available in THIS environment (422) — registered but
  // filtered out here (e.g. a mock in prod). Actionable: pick a provider available here.
  "provider-unavailable",
  // The chosen provider REJECTED the request shape (422) — unsupported params / aspect ratio.
  // Actionable: pick a different ratio or provider.
  "invalid-params",
  // The fork phase reached the city but the image forge upstream FAILED (502) — the provider
  // call threw or the upstream returned non-2xx. Transient; retry is honest advice.
  "provider-upstream",
  // An UNEXPECTED, deterministic server-side fault (500) — a programming bug, an R2 write
  // failure, a D1 failure inside createPost. Distinct from `provider-upstream` precisely so the
  // visitor is NOT told "the forge hit a snag; try again" when retrying cannot help. The
  // technical detail goes to the console; this cause only says "the fault is ours, and logged."
  "internal",
  // The parent / mate slop is gone (404) — stale or deleted between page load and submit.
  "parent-not-found",
  // The chosen provider id is not registered (404) — a typo'd / crafted id the UI never offers.
  "provider-not-registered",
] as const

export type ForkErrorCause = (typeof FORK_ERROR_CAUSES)[number]

// [LAW:one-source-of-truth] cause → honest HTTP status, the single pairing both routes build
// their error responses through. The status accompanies the cause for HTTP-layer consumers
// (caching, monitoring, retries); the cause carries the meaning the visitor pause keys on.
export const FORK_ERROR_STATUS: Record<ForkErrorCause, number> = {
  "budget-exhausted": 429,
  "budget-unavailable": 503,
  "provider-unavailable": 422,
  "invalid-params": 422,
  "provider-upstream": 502,
  "internal": 500,
  "parent-not-found": 404,
  "provider-not-registered": 404,
}

// [LAW:single-enforcer] The ONE builder of a fork/breed error response. The routes never
// hand-write `{ status }` for a failure — they name a cause and the honest status follows from
// the table, so a status can never drift from its cause. `message` is the dev/console line
// (never shown to the visitor); `extra` carries diagnostic fields (providerId, issues, …).
export function forkErrorResponse(
  cause: ForkErrorCause,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  return Response.json(
    { error: message, cause, ...extra },
    { status: FORK_ERROR_STATUS[cause] },
  )
}

// [LAW:no-silent-failure] Parse the cause back out of a fork/breed error response body. Returns
// `null` — never a guessed cause — when the body is absent, not an object, or carries no known
// cause (a framework 500, a Cloudflare edge error, a non-JSON page, a true network failure).
// The client treats a `null` cause as the quiet `unknown` pause; it never invents a meaning.
const causeBodySchema = z.object({ cause: z.enum(FORK_ERROR_CAUSES) })

export function parseForkErrorCause(body: unknown): ForkErrorCause | null {
  const parsed = causeBodySchema.safeParse(body)
  return parsed.success ? parsed.data.cause : null
}
