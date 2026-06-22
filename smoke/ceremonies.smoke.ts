import { beforeAll, describe, expect, it } from 'vitest'
import { ceremonyTarget, type CeremonyTarget } from './config'

// [LAW:behavior-not-structure] TIER 2 — the daily ceremonies as real round-trips against a
// RUNNING (dev/staging) worker, driven through the slopspot-ceremony-test-0zy.4 actuator
// (POST /admin/ceremony/:name?key=<ADMIN_KEY>). This is the "verify on DEPLOY, not at 3am"
// rung: the in-isolate dispatch test (app/agents/__tests__/scheduled.test.ts) already fires the
// real scheduled handler on every push, but only THIS tier exercises the wiring an isolate
// cannot — the deployed binding config, the KV/R2/D1 the staging env actually points at, the
// fetch-boundary metric flush — by firing each ceremony over HTTP and reading its outcome back
// through the deployed runtime's own /metrics scrape. [LAW:verifiable-goals]
//
// [LAW:no-silent-fallbacks] These FIRE REAL ceremonies (they write rows), so the suite targets a
// DEV/STAGING worker only — the actuator 404s outside SLOPSPOT_ENV=dev by construction, so it
// cannot even be reached on prod. ceremonyTarget() demands SMOKE_WRITE_BASE_URL + ADMIN_KEY and
// throws in beforeAll when unset, so a run against nothing fails LOUD rather than greenwashing.
//
// [LAW:no-ambient-temporal-coupling] A FIXED historical scheduledTime is the idempotency lever:
// every ceremony derives its day-key from it, so re-runs land on the SETTLED day (already-fell /
// already-crowned / already-born / already-decreed / barren) and write NO new rows — the suite is
// safe to run repeatedly against a persistent staging DB. The first-ever run may write one settled
// row per ceremony for this day-key (e.g. one born citizen); every run thereafter is a pure no-op.
const SMOKE_TIME = Date.UTC(2026, 0, 15, 3, 0)

type CeremonyResponse = { ceremony: string; scheduledTime: number; result?: { kind?: string } }

// [LAW:one-source-of-truth] The cheap, ALWAYS-EMITTING ceremonies. Each emits its outcome metric on
// EVERY fire — including the idempotent re-fire outcomes (already-* / barren / unmoved) — so a
// "fire → counter incremented" check is reliable and re-runnable. The validKinds are the closed
// result unions from the ceremony cores (grace.ts GraceResult, rite.ts RiteResult, midwife.ts
// BirthResult, firstPoet.ts FirstPoetResult); trait-spread returns void → no result body. We assert
// the kind is a MEMBER of its union, never a specific kind — the kind is emergent from corpus state
// (the dispatch contract is "a valid outcome flushed through the deployed runtime", not which one).
// [LAW:behavior-not-structure]
//
// PORTRAIT IS ABSENT HERE on purpose (see the opt-in test below): it costs real provider money
// unless staging personas are re-mediumed to -mock siblings, AND it emits NOTHING on a re-fire once
// faces are settled (empty target set = silent no-op) — so a metric-increment assertion would be
// both expensive and flaky. Its honest smoke check is "the actuator round-trips", not "it emitted".
const CHEAP_CEREMONIES = [
  { name: 'grace', metric: 'slopspot_grace_outcome', validKinds: ['fell', 'already-fell', 'withheld', 'barren'] },
  { name: 'rite', metric: 'slopspot_rite_outcome', validKinds: ['crowned', 'unmoved'] },
  { name: 'birth', metric: 'slopspot_birth_outcome', validKinds: ['born', 'already-born', 'skipped'] },
  { name: 'first-poet', metric: 'slopspot_firstpoet_decree', validKinds: ['decreed', 'already-decreed', 'no-poet'] },
  // trait-spread is pure observation (Promise<void>): no result body, 8 emitted series (2 cohorts × 4 axes).
  { name: 'trait-spread', metric: 'slopspot_trait_spread', validKinds: null },
] as const

// Fire one named ceremony through the deployed actuator. The key + optional time ride the URL
// exactly as requireAdmin + the route's effect-boundary clock read expect them.
async function fireCeremony(target: CeremonyTarget, name: string, timeMs: number): Promise<Response> {
  const url = `${target.baseUrl}/admin/ceremony/${name}?key=${encodeURIComponent(target.adminKey)}&time=${timeMs}`
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' } })
}

// Read the DURABLE counter total for a metric from the deployed /metrics scrape (the same
// Prometheus exposition the home-infra puller reads). The counter is monotonic and labelled, so we
// SUM every series of this metric name; each ceremony fire bumps exactly one series by 1 (or +8 for
// trait-spread), so the sum strictly increases per fire regardless of which outcome occurred.
async function readMetricTotal(target: CeremonyTarget, promMetric: string): Promise<number> {
  const res = await fetch(`${target.baseUrl}/metrics`)
  expect(res.status, 'GET /metrics must serve the durable scrape (200)').toBe(200)
  const text = await res.text()
  let total = 0
  for (const line of text.split('\n')) {
    // A series line is `<name>{labels} <value>` (these metrics always carry labels).
    if (!line.startsWith(`${promMetric}{`)) continue
    const value = Number(line.slice(line.lastIndexOf(' ') + 1))
    if (Number.isFinite(value)) total += value
  }
  return total
}

// [LAW:no-ambient-temporal-coupling] The actuator flushes its metric buffer to D1 in
// ctx.waitUntil — AFTER the response returns (workers/app.ts fetch boundary) — so the durable
// counter is eventually, not immediately, consistent with the 200. We do NOT assume ordering: we
// poll the durable view until the increment is observed and fail LOUD on timeout. The exit
// condition is the OBSERVED state change, not a fixed sleep; the delay is only backoff between
// polls. [LAW:no-silent-failure]
async function expectMetricIncrement(target: CeremonyTarget, promMetric: string, fire: () => Promise<void>): Promise<void> {
  const before = await readMetricTotal(target, promMetric)
  await fire()
  const deadline = Date.now() + 15_000
  for (;;) {
    const after = await readMetricTotal(target, promMetric)
    if (after > before) return
    if (Date.now() >= deadline) {
      throw new Error(
        `[smoke] ${promMetric} did not increment within 15s of firing — the ceremony's emit never reached the durable /metrics view (before=${before}, last=${after})`,
      )
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}

describe('ceremony actuator round-trips (fires REAL ceremonies — dev/staging only)', () => {
  let target: CeremonyTarget
  beforeAll(() => {
    // [LAW:no-silent-fallbacks] Loud failure if the actuator target is unconfigured.
    target = ceremonyTarget()
  })

  // The acceptance headline and the four siblings, one check each: the actuator fires the ceremony
  // through the deployed runtime, returns its TYPED result, and the outcome metric round-trips to
  // the durable /metrics view. The title head (before the first ':') is the prober's stable check
  // label, so each ceremony gets its own Prometheus series if this suite is ever probed.
  for (const c of CHEAP_CEREMONIES) {
    it(`ceremony ${c.name}: actuator → typed result → outcome metric flushed to durable /metrics`, async () => {
      let body: CeremonyResponse | undefined
      await expectMetricIncrement(target, c.metric, async () => {
        const res = await fireCeremony(target, c.name, SMOKE_TIME)
        expect(res.status, `firing ${c.name} must be 200 (got ${res.status})`).toBe(200)
        body = (await res.json()) as CeremonyResponse
      })

      // The actuator echoes the ceremony name and the scheduledTime it was driven with — proof the
      // ?time override was read at the effect boundary and routed to THIS registry entry.
      expect(body!.ceremony).toBe(c.name)
      expect(body!.scheduledTime).toBe(SMOKE_TIME)

      // The typed result IS the row/utterance round-trip's observable shadow at the HTTP boundary:
      // a `born`/`fell`/`crowned`/`decreed` kind carries the written row's identity, the settled
      // kinds carry the day's prior truth. We assert the kind is a MEMBER of the closed union, never
      // a specific one (the outcome is emergent from corpus state). trait-spread returns void.
      if (c.validKinds === null) {
        expect(body!.result, `${c.name} returns void → no result body`).toBeUndefined()
      } else {
        expect(c.validKinds as readonly string[], `${c.name} kind must be a member of its result union`).toContain(
          body!.result?.kind,
        )
      }
    })
  }

  // [LAW:no-silent-failure] PORTRAIT is opt-in (SMOKE_CEREMONY_PORTRAIT=1) and cost-gated: firing it
  // renders each citizen via persona.medium = a REAL provider, so it spends real money unless staging
  // generator personas are first re-mediumed to their -mock siblings (the actuator's PORTRAIT CAVEAT;
  // test DATA, applied out-of-band before opting in). And because a settled face emits nothing, we
  // assert ONLY the actuator round-trip (200 + void result) — the dispatch-wiring proof — never a
  // metric increment, which would be flaky. Skipped-but-loud when not opted in, so the gap is visible.
  const includePortrait = process.env.SMOKE_CEREMONY_PORTRAIT === '1'
  it.skipIf(!includePortrait)('ceremony portrait: actuator round-trips (opt-in; real provider unless re-mediumed)', async () => {
    const res = await fireCeremony(target, 'portrait', SMOKE_TIME)
    expect(res.status, `firing portrait must be 200 (got ${res.status})`).toBe(200)
    const body = (await res.json()) as CeremonyResponse
    expect(body.ceremony).toBe('portrait')
    expect(body.scheduledTime).toBe(SMOKE_TIME)
    expect(body.result, 'portrait returns void → no result body').toBeUndefined()
  })

  // The deployed actuator's gate surface, verified through the real runtime (the .4 contract,
  // re-confirmed on deploy): a bad key is 401 (requireAdmin, NOT 403), an unknown ceremony name is
  // 404 (CEREMONIES.find is the membership check), a non-integer ?time is 400 (rejected at the
  // boundary, never fed downstream as NaN). All three are pure — no ceremony fires.
  it('actuator gate: bad key → 401', async () => {
    const url = `${target.baseUrl}/admin/ceremony/grace?key=definitely-wrong&time=${SMOKE_TIME}`
    const res = await fetch(url, { method: 'POST' })
    expect(res.status, 'bad admin key must be 401').toBe(401)
  })

  it('actuator gate: unknown ceremony name → 404', async () => {
    const res = await fireCeremony(target, 'not-a-ceremony', SMOKE_TIME)
    expect(res.status, 'unknown ceremony name must be 404').toBe(404)
  })

  it('actuator gate: non-integer ?time → 400', async () => {
    const url = `${target.baseUrl}/admin/ceremony/grace?key=${encodeURIComponent(target.adminKey)}&time=not-a-number`
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' } })
    expect(res.status, 'non-integer ?time must be 400').toBe(400)
  })
})
