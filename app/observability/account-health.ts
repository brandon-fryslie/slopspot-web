// [LAW:single-enforcer] The account-health layer: ONE type for "is an external account
// working", ONE emitter, ONE status→reason classifier. Every external-account boundary in
// the Worker (the Anthropic transport leaf, the Replicate transport leaf, the fal provider)
// classifies its OWN failure here and reports through reportAccountHealth — so the metric's
// name, label shape, and the meaning of each status live in exactly one place and no boundary
// can invent a second shape.
//
// [LAW:one-source-of-truth] This stream is the canonical "account state" signal: the vmalert
// rule pages on status=down and the all-things dashboard reads the same samples. It is
// orthogonal to slopspot.composer.result (a COMPOSITION outcome — haiku vs recipe-fallback);
// the two can both fire on one Anthropic auth failure because they answer different questions.

import { emit } from './metrics'

// [LAW:types-are-the-program] The closed set of external accounts the Worker holds credentials
// for. An account is a CREDENTIAL, deliberately COARSER than a provider: replicate-ideogram and
// replicate-sdxl are two providers billing ONE Replicate account, so the page names the account
// an operator must fix, never the model that happened to make the call. A typo'd account is a
// compile error, and the alert's cardinality stays bounded (3 accounts × 3 statuses).
export type Account = 'anthropic' | 'fal' | 'replicate'

// [LAW:types-are-the-program] The health of one external account observed at one call.
//   ok       — the call succeeded; emitting it lets the alert AUTO-RESOLVE when an account recovers.
//   down     — the account is unusable and an OPERATOR must act. Split by the action each needs:
//              auth (dead/expired credential), payment (out of money), quota (rate or usage cap).
//   degraded — a transient upstream fault (5xx / timeout / network / any non-credential status)
//              that self-heals. Observed for the dashboard, NEVER alerted.
// The three arms are exhaustive and reason exists ONLY on down — { status:'down' } with no reason,
// or { status:'ok'; reason } are both unrepresentable. This OUTPUT type and the metric are ONE.
export type AccountHealth =
  | { status: 'ok' }
  | { status: 'degraded' }
  | { status: 'down'; reason: 'auth' | 'payment' | 'quota' }

// [LAW:single-enforcer] The ONE place an account-health sample is emitted; boundaries hand a
// classified AccountHealth and never touch emit() for this metric directly.
// [LAW:dataflow-not-control-flow] every boundary calls this UNCONDITIONALLY on both success and
// failure — the data (down vs ok vs degraded) is what the alert rule reads to decide to fire, not
// a branch at the call site over whether to report.
export function reportAccountHealth(account: Account, health: AccountHealth): void {
  emit(
    'slopspot.account.health',
    health.status === 'down'
      ? { account, status: 'down', reason: health.reason }
      : { account, status: health.status },
    1,
  )
}

// [LAW:one-source-of-truth] HTTP status → health is a UNIVERSAL mapping; the only per-account
// asymmetry is EXTRACTING the status from each client's native error (Anthropic's
// AnthropicHttpError.status, fal's ApiError.status, Replicate's ReplicateHttpError.status), which
// is each boundary's own concern. Mapping that status to a reason is shared, so the three accounts
// cannot drift on "what does 402 mean". 401/403 = dead/expired credential (auth); 402 = out of
// money (payment); 429 = rate or usage cap (quota); every other status self-heals → degraded.
export function healthFromHttpStatus(status: number): AccountHealth {
  if (status === 401 || status === 403) return { status: 'down', reason: 'auth' }
  if (status === 402) return { status: 'down', reason: 'payment' }
  if (status === 429) return { status: 'down', reason: 'quota' }
  return { status: 'degraded' }
}
