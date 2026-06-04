// [LAW:single-enforcer] One module emits all metrics; every call site in the app
// goes through `emit`. There is no alternate console.log('metric.…') shape elsewhere
// in the codebase. The puller in ~/code/home-infra reads Cloudflare Logs filtered
// by the `[metric]` prefix; changing this module is the single point of contact
// between the app and that pipeline.
//
// [LAW:types-are-the-program] Each metric has a fixed label shape. `emit` is
// typed so the label record for `FIREHOSE_FIRE` (channel + outcome) cannot
// be confused with the label record for `POST_CREATED` (content_kind + provider_id +
// style_family). Typo'd label keys, missing labels, and wrong-shape labels are
// compile errors, not runtime drift. Adding a metric is a one-place change to
// `MetricLabels`; the rest of the code can't drift because there's nowhere else
// to express the names.
//
// [LAW:one-source-of-truth] The metric NAMES live in `MetricName`; the label
// SHAPES live in `MetricLabels`. Both are derived from the same union, so
// adding a metric in one place forces the other to catch up at compile time.

import type { RiteLens } from '~/lib/domain'

// The puller (homelab-side) parses log lines that start with `[metric]`. Changing
// this prefix without coordinating with the puller will drop metrics silently.
const LOG_PREFIX = '[metric]' as const

// [LAW:types-are-the-program] The shape that makes illegal emission unrepresentable:
// every legal (metric, labels) pair is a key/value entry in one record; nothing
// outside that record can be emitted, and nothing inside it can be emitted with
// the wrong labels.
export type MetricLabels = {
  'slopspot.firehose.fire': {
    channel: string
    outcome: 'fired' | 'skipped-budget' | 'skipped-error'
  }
  'slopspot.write.batch_outcome': {
    content_kind: 'generation' | 'found' | 'upload'
    outcome: 'success' | 'failed'
  }
  'slopspot.write.orphan_detected': {
    content_kind: 'generation' | 'found' | 'upload'
  }
  // [LAW:no-silent-fallbacks] setVote emits this when the vote COMMITTED but the
  // posts.score materialization UPDATE reported success:false (the non-throwing partial
  // failure the orphan incident exposed). The cache column is momentarily stale; it
  // self-heals on the next vote to this post (the UPDATE recomputes from votes) and the
  // backfill UPDATE is the global recovery. The metric makes the rare drift a queryable
  // signal instead of a silent stale read. [LAW:single-enforcer] setVote is the sole emitter.
  'slopspot.score.drift': {
    post_id: string
  }
  'slopspot.post.created': {
    content_kind: 'generation' | 'found' | 'upload'
    provider_id: string
    style_family: string
  }
  'slopspot.provider.generate_duration_ms': {
    provider_id: string
    outcome: 'success' | 'failed'
  }
  'slopspot.provider.cost_usd': {
    provider_id: string
  }
  // [LAW:types-are-the-program] Discriminated union: reason is required on fallback
  // and absent on haiku, making { outcome:'fallback' } (no reason) or
  // { outcome:'haiku', reason:... } (spurious reason) unrepresentable.
  // [LAW:single-enforcer] composer.ts is the sole emitter of this metric —
  // it is the only place where the Haiku-vs-fallback decision is made.
  // [LAW:no-silent-fallbacks] `auth_error` (Anthropic 401/403) is split from the
  // transient `api_error` because they need different responses: an auth_error is an
  // OPERATOR-actionable degradation — a dead/expired key silently template-falling-
  // back the whole firehose (the slopspot-breeding-3xe.1 prod incident) — and merits
  // an alert, whereas a transient 5xx self-heals. Naming it makes the key-death case
  // its own queryable signal (slopspot-observability-2hm), not a buried blip.
  'slopspot.composer.result':
    | { outcome: 'haiku' }
    | { outcome: 'fallback'; reason: 'missing_key' | 'auth_error' | 'api_error' }
  // [LAW:no-silent-fallbacks] The feed reader emits this when it derives a placard
  // for a generation row whose stored title is empty. It makes the deterministic
  // fallback LOUD — a count of unnamed pieces — rather than a silent blank placard.
  // The reason is the OBSERVABLE fact (empty title), not an inferred provenance:
  // the expected cause is a pre-migration row, but a future write-path bug would
  // surface here too, which is exactly what the metric should let you catch.
  // [LAW:single-enforcer] feed.ts toContent is the sole emitter.
  'slopspot.feed.title_fallback': { reason: 'empty_title' }
  // [LAW:single-enforcer] getFeedPage is the sole emitter. A client-supplied feed cursor that fails
  // the trust-boundary parse (`garbage`) or names a different sort than the request (`mode_mismatch`)
  // is DEGRADED to page 1 — not an error, but a counter so a client bug is visible long before a
  // user reports "the feed jumps to the top." [LAW:no-silent-fallbacks] the degradation is observable.
  'slopspot.feed.cursor_rejected': { reason: 'garbage' | 'mode_mismatch' }
  // [LAW:single-enforcer] The Cast self-portrait pass (agents/portrait.ts) is the
  // sole emitter. One sample per citizen the pass touched: `rendered` (a new face
  // committed), `failed` (the generation threw — the failed slop row is observable),
  // or `skipped-budget` (the daily cap was hit before this target fired). The agent
  // label is the citizen so per-citizen drift cadence is queryable.
  'slopspot.portrait.render': {
    agent_id: string
    outcome: 'rendered' | 'failed' | 'skipped-budget'
  }
  // [LAW:single-enforcer] The Daily Rite (app/agents/rite.ts) is the sole emitter.
  // One sample per nightly ceremony: `crowned` (a slop took the crown), `unmoved`
  // (the Unmoved Day — nobody cleared the bar, the crown stayed in the drawer), or
  // `already-crowned` (a re-fire found the day already settled — idempotent no-op).
  // The lens label makes per-lens crown cadence queryable across the liturgical week.
  // [LAW:types-are-the-program] lens is the closed RiteLens union, not an open string,
  // so a typo'd `lens: 'saints'` is a compile error like every other metric label.
  'slopspot.rite.outcome': {
    lens: RiteLens
    outcome: 'crowned' | 'unmoved' | 'already-crowned'
  }
}

export type MetricName = keyof MetricLabels

// [LAW:single-enforcer] Every call site goes through `emit`. Disabling metrics
// is configuration (drop the puller, or filter on the homelab side), never a
// branch inside callers. [LAW:dataflow-not-control-flow] same code every call.
export function emit<K extends MetricName>(
  name: K,
  labels: MetricLabels[K],
  value: number,
): void {
  // Cloudflare's Workers Logs surfaces console.log with its second argument as a
  // structured field. The puller reads `message[0]` for the prefix+name and
  // `message[1]` for the labels+value object, so the shape here is the API.
  console.log(`${LOG_PREFIX} ${name}`, { ...labels, value })
}
