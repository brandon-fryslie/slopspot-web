// [LAW:single-enforcer] One module emits all metrics; every call site in the app
// goes through `emit`. There is no alternate console.log('metric.…') shape elsewhere
// in the codebase. The puller in ~/code/home-infra reads Cloudflare Logs filtered
// by the `[metric]` prefix. `formatPrometheusMetrics()` exposes the same data as
// Prometheus text for the /metrics scrape endpoint — same emission boundary, second
// output channel.
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
import type { BreedPauseReason } from '~/lib/breed-failure'
import type { TraitAxis } from '~/lib/traits'

// The puller (homelab-side) parses log lines that start with `[metric]`. Changing
// this prefix without coordinating with the puller will drop metrics silently.
const LOG_PREFIX = '[metric]' as const

// [LAW:one-source-of-truth] Single accumulator for both the console-log path (existing)
// and the Prometheus scrape path (new). Per-isolate in-memory state — resets on cold start.
// For SlopSpot's traffic pattern, the primary active isolate holds most metrics;
// scrape intervals under Cloudflare's ~30s idle timeout reliably hit a warm instance.
// VM push (InfluxDB line protocol) is blocked on a public write ingress — see wrangler.jsonc.
type MetricEntry = { name: string; labels: Record<string, string | number>; value: number }
const counters: Map<string, MetricEntry> = new Map()

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
  // [LAW:single-enforcer] HTTP request counter — emitted from workers/app.ts after every
  // fetch response. route is the normalizeRoute() label; status is the HTTP status code.
  // Together they give request-rate and error-rate sliced by route without raw-URL cardinality.
  'slopspot.http.request': {
    route: string
    status: string
  }
  // [LAW:single-enforcer] HTTP latency histogram — emitted alongside http.request. outcome
  // collapses the status space to two actionable signals (success = 2xx/3xx, error = 4xx/5xx).
  'slopspot.http.latency_ms': {
    route: string
    outcome: 'success' | 'error'
  }
  // [LAW:types-are-the-program] The daily Birth Engine's one outcome metric. The cadence is a
  // TARGET (one citizen/day), not a guarantee — so a `skipped` day is a first-class, OBSERVABLE
  // outcome, never a silent miss. `born` = a new citizen written; `already-born` = the day was
  // settled (idempotent re-fire); `skipped-indistinct` = the midwife could not author a citizen
  // distinct from the cast within the attempt budget (an honest no-birth over a polluting
  // duplicate); `skipped-llm` = the LLM author failed every attempt. The two skips are LOGGED
  // loudly at the call site so a missed-cadence day surfaces. [LAW:no-silent-fallbacks]
  'slopspot.birth.outcome': {
    outcome: 'born' | 'already-born' | 'skipped-indistinct' | 'skipped-llm'
  }
  // [LAW:no-silent-fallbacks] The Birth RITE's own signal — separate from birth.outcome because the birth
  // (the persona row) is PRIMARY TRUTH and the Proprietor's welcome is best-effort NARRATION of it. The
  // welcome can fail without un-birthing a citizen, so its outcome is observable here on its own axis:
  // `spoke`/`withheld` = the welcome was recorded (a line, or a meant silence); `failed` = it could not be
  // voiced or persisted (citizen born but unannounced — surfaced loudly so an operator sees it).
  'slopspot.birth.announce': {
    outcome: 'spoke' | 'withheld' | 'failed'
  }
  // [LAW:no-silent-fallbacks] The newcomer's DEBUT — its first act, fired at birth so it acts within its
  // first cycle BY CONSTRUCTION (make-it-impossible; a firehose hash-pick is only ~likely). Its own axis,
  // separate from the birth (primary truth) and the welcome: `authored` = the first slop was made;
  // `skipped-budget` = the daily spend cap was hit (a deliberate city pause — the newcomer still acts later
  // via the firehose pool, also gated); `failed` = the provider/write failed (born, not yet acted —
  // observable, never an un-birth or a crash of the birth ceremony).
  'slopspot.birth.debut': {
    outcome: 'authored' | 'skipped-budget' | 'failed'
  }
  // [LAW:dataflow-not-control-flow] The First-Poet Rite's signal — fired every daily tick, the DATA picking
  // the outcome: `decreed` = the city's first poet was marked just now; `already-decreed` = the once-ever
  // honor was already recorded (the idempotent no-op, the steady state after the first poet exists);
  // `no-poet` = no verse-citizen exists yet (the city has not written). The cadence of `no-poet` → `decreed`
  // → `already-decreed` is the watchable emergence the verse-weight knob (deferred) would tune.
  'slopspot.firstpoet.decree': {
    outcome: 'decreed' | 'already-decreed' | 'no-poet'
  }
  // [LAW:no-silent-fallbacks][LAW:dataflow-not-control-flow] Typed account-health signal. Fired
  // unconditionally at every external-account trust boundary (Anthropic, fal, Replicate) — the DATA
  // (ok/down/degraded) decides whether the vmalert rule fires. Classification is per-account (each service
  // has a different error taxonomy); the status+reason are the output type of that classification.
  //
  // [LAW:single-enforcer] Alertmanager is the ONE alerter — dedup/grouping/repeat-interval live there.
  // This metric is the stream; the vmalert rule `status="down"` is the gate. `ok` on every successful call
  // enables alertmanager auto-resolve (the alert fires on down, clears on next ok).
  //
  // [LAW:types-are-the-program] Discriminated union: `reason` is REQUIRED when status=down
  // and ABSENT otherwise — a down-with-no-reason or an ok-with-reason cannot be expressed.
  'slopspot.account.health':
    | { account: string; status: 'ok' | 'degraded' }
    | { account: string; status: 'down'; reason: 'auth' | 'payment' | 'quota' }
  // [LAW:dataflow-not-control-flow] The Patronage's Grace pass (ts7.8), fired every daily tick — the DATA
  // picks the outcome: `fell` = a citizen chose a human just now (a grace recorded); `already-fell` = the
  // day's grace was already recorded (idempotent re-fire on the UNIQUE grace_day); `withheld` = grace did
  // not fall this pass (the rarity gate, the ~common case — grace is rare and useless by design); `barren`
  // = no eligible corpus edge exists yet (no human has engaged a citizen's made-thing). The cadence of
  // `withheld`/`barren` → `fell` → `already-fell` is the watchable rarity the graceFallRate knob tunes.
  'slopspot.grace.outcome': {
    outcome: 'fell' | 'already-fell' | 'withheld' | 'barren'
  }
  // [LAW:no-silent-fallbacks] The Third-Person Reveal's OWN signal (ts7.9) — separate from grace.outcome
  // because the reveal (the citizen's third-person line) can fail to compose or persist WITHOUT un-recording
  // the grace, so its outcome is observable on its own axis (mirrors birth.announce): `spoke` = the line was
  // uttered and recorded; `withheld` = the voice degraded to a recorded silence; `absent` = the made-thing or
  // its maker had vanished, nothing to ground (best-effort skip, the grace stays recorded); `failed` = the
  // compose/persist threw (caught, surfaced, never an un-grace).
  'slopspot.grace.reveal': {
    outcome: 'spoke' | 'withheld' | 'absent' | 'failed'
  }
  // [LAW:no-silent-failure] The visitor-facing pause the fork/breed flow showed. The
  // pause is classified IN THE BROWSER (the rewrite stream parse and the unexpected-throw
  // arms have no server equivalent), so it cannot be observed from the Worker alone — the
  // client beacons it to /api/metrics/fork-pause, which is the sole emitter. A client-side
  // emit() would only console.log in the browser, which the Workers-Logs puller never sees;
  // routing through the server is what makes this metric REAL in VictoriaMetrics instead of
  // a silent no-op. [LAW:single-enforcer] api.metrics.fork-pause.ts is the one emitter.
  // [LAW:types-are-the-program] reason is the closed BreedPauseReason union (a typo is a
  // compile error); surface separates the fork journey from the breed journey.
  'slopspot.fork.pause': {
    surface: 'fork' | 'breed'
    reason: BreedPauseReason
  }
  // [LAW:verifiable-goals] The breadth directive's concrete "done" shape made queryable: the per-axis
  // dispersion (population stddev, in the axis's [0,1] units) of what is GENERATED vs what SURVIVES
  // (the top-ranked-by-score cohort). RANGE is the product (genome-3un); this metric is how
  // "monoculture broke" stops being a guess — healthy is BOTH cohorts wide, selection-eating-the-range
  // is generated wide + surviving narrow. Eight series (2 cohorts × 4 axes), low cardinality.
  // [LAW:single-enforcer] app/agents/traitSpread.ts (the daily measurement ceremony) is the sole emitter.
  // [LAW:no-silent-failure] The [metric]→VM puller does NOT exist yet (efficiency-a5w.7) — this emit
  // reaches Workers Logs + the /metrics scrape accumulator, NOT a dashboard. The ticket's ACCEPTANCE
  // proof is therefore a DIRECT D1 read (app/db/trait-spread.ts), never this (possibly uncollected) emit.
  // [LAW:types-are-the-program] axis is the closed TraitAxis union — a typo'd axis is a compile error.
  'slopspot.trait.spread': {
    cohort: 'generated' | 'surviving'
    axis: TraitAxis
  }
}

export type MetricName = keyof MetricLabels

// [LAW:types-are-the-program] The account-health payload without the account label — what each
// account-boundary classifier returns. The account string is added at the emit call site.
// Exported so classifiers in haiku.ts and replicate-helpers.ts can return this type without
// importing the full MetricLabels union.
export type AccountHealthPayload =
  | { status: 'ok' | 'degraded' }
  | { status: 'down'; reason: 'auth' | 'payment' | 'quota' }

// [LAW:single-enforcer] The discriminated-union spread `{ account, ...payload }` does not compose
// cleanly in TypeScript (union spreads produce intersections, not unions). This helper applies the
// discriminant switch once so every call site remains terse and compile-time-checked.
export function emitAccountHealth(account: string, payload: AccountHealthPayload): void {
  if (payload.status === 'down') {
    emit('slopspot.account.health', { account, status: 'down', reason: payload.reason }, 1)
  } else {
    emit('slopspot.account.health', { account, status: payload.status }, 1)
  }
}

// Stable key for a (name, labels) pair — used to deduplicate counter entries.
function metricKey(name: string, labels: Record<string, string | number>): string {
  const sorted = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',')
  return `${name};${sorted}`
}

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
  // Accumulate into the in-process counter store — feeds /metrics scrape endpoint.
  const key = metricKey(name, labels as Record<string, string | number>)
  const existing = counters.get(key)
  counters.set(key, existing ? { ...existing, value: existing.value + value } : { name, labels: labels as Record<string, string | number>, value })
}

// Formats accumulated counters as Prometheus text exposition format (version 0.0.4).
// Metric names use underscores (Prometheus convention); label values are quoted strings.
// Called by the /metrics resource route.
export function formatPrometheusMetrics(): string {
  const lines: string[] = []
  for (const { name, labels, value } of counters.values()) {
    const promName = name.replace(/\./g, '_')
    const labelPairs = Object.entries(labels)
      .map(([k, v]) => `${k}="${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
      .join(',')
    lines.push(`${promName}{${labelPairs}} ${value}`)
  }
  return lines.join('\n')
}

// Test helper: returns a snapshot of current counters without mutating them.
export function snapshotCountersForTesting(): ReadonlyMap<string, MetricEntry> {
  return new Map(counters)
}

// Test helper: clears the counter store. Call in afterEach to prevent test pollution.
export function resetCountersForTesting(): void {
  counters.clear()
}
