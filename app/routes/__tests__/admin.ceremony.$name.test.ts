// [LAW:verifiable-goals] The staging actuator's trust-boundary contract (slopspot-ceremony-test-0zy.4).
// The action IS the boundary, so the action is what's under test — driven directly, not through
// worker.fetch (the `fetch` path resolves virtual:react-router/server-build, which the vitest workers
// pool does not provide; the .3 dispatch test reaches the registry via worker.scheduled for the same
// reason). Real D1/R2 from the same migrations prod runs; the ONLY externality faked is the LLM author,
// at its declared seam — SLOPSPOT_ENV='dev' selects haiku.ts's deterministic fake, exactly as prod's
// own -mock gate does. [LAW:effects-at-boundaries]
//
// The gates are asserted in the order the route fails them (outermost first): the SLOPSPOT_ENV 404
// precedes auth (prod presents the route as nonexistent — never even reveals auth lives here), then
// method, then admin key, then ceremony-name membership, then the ?time override. The success arm
// fires ONE registry ceremony (birth, in roster-regime since no portrait runs first) and proves the
// actuator returns the ceremony's typed result and is idempotent on a same-day re-fire.
// [LAW:behavior-not-structure] — we assert the observable outcome, never the internal that produced it.

import { env, createExecutionContext } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { action } from '../admin.ceremony.$name'
import { resetCountersForTesting } from '~/observability/metrics'
import { db } from '~/db/client'
import { personas } from '~/db/schema'

const ADMIN_KEY = 'test-admin-key'

// 2026-01-15 03:00 UTC — the same instant the .3 dispatch test pins; the fake author births
// `agent:born-2026-01-15` deterministically from it.
const SCHEDULED_MS = Date.UTC(2026, 0, 15, 3, 0)

const mkEnv = (over: Partial<Env> = {}): Env =>
  ({ ...env, SLOPSPOT_ENV: 'dev', ADMIN_KEY, ...over }) as Env

function call(
  e: Env,
  name: string,
  { method = 'POST', key, time }: { method?: string; key?: string; time?: string } = {},
): Promise<Response> {
  const url = new URL(`https://slopspot.ai/admin/ceremony/${name}`)
  if (key !== undefined) url.searchParams.set('key', key)
  if (time !== undefined) url.searchParams.set('time', time)
  const request = new Request(url, { method })
  const context = { cloudflare: { env: e, ctx: createExecutionContext() } }
  return action({ request, params: { name }, context } as unknown as Parameters<typeof action>[0])
}

const personaCount = async (e: Env): Promise<number> => (await db(e).select().from(personas)).length

describe('admin.ceremony.$name - the staging actuator', () => {
  beforeEach(() => {
    resetCountersForTesting()
  })

  it('404s outside dev — and the env gate is OUTERMOST (404, not 401, even with no key)', async () => {
    // Everything else valid, prod env → still 404: prod can never be poked.
    const validInProd = await call(mkEnv({ SLOPSPOT_ENV: 'prod' }), 'birth', { key: ADMIN_KEY })
    expect(validInProd.status).toBe(404)
    // No key in prod → 404, NOT 401: the env gate runs before auth, so prod never reveals auth lives here.
    const noKeyInProd = await call(mkEnv({ SLOPSPOT_ENV: 'prod' }), 'birth', {})
    expect(noKeyInProd.status).toBe(404)
  })

  it('405s a non-POST verb that reaches the action, so it cannot fire a ceremony', async () => {
    // RR7 routes every non-GET method to the action; the guard rejects all but POST. (A GET never
    // reaches here — with no loader exported, RR7 itself answers a GET with 400 upstream. So the
    // guard's live job is exactly this: stop a DELETE/PUT/PATCH from firing a ceremony.) Verified
    // end-to-end against `pnpm dev`: DELETE/PUT -> 405, GET -> 400, POST -> fires.
    expect((await call(mkEnv(), 'birth', { method: 'DELETE', key: ADMIN_KEY })).status).toBe(405)
    expect((await call(mkEnv(), 'birth', { method: 'PUT', key: ADMIN_KEY })).status).toBe(405)
  })

  it('rejects a bad/absent admin key with 401 (requireAdmin reused unchanged)', async () => {
    // requireAdmin throws data('Unauthorized', { status: 401 }); RR7 converts that thrown value to a
    // 401 Response at the HTTP boundary (the conversion every admin route already relies on). Driving
    // the action directly surfaces the raw thrown value, so we assert its tagged status.
    await expect(call(mkEnv(), 'birth', {})).rejects.toMatchObject({ init: { status: 401 } })
    await expect(call(mkEnv(), 'birth', { key: 'wrong' })).rejects.toMatchObject({ init: { status: 401 } })
  })

  it('404s an unknown ceremony name (membership checked against the one registry)', async () => {
    const res = await call(mkEnv(), 'not-a-ceremony', { key: ADMIN_KEY })
    expect(res.status).toBe(404)
  })

  it('400s a provided-but-non-integer ?time, rather than feeding NaN downstream', async () => {
    const res = await call(mkEnv(), 'birth', { key: ADMIN_KEY, time: 'abc' })
    expect(res.status).toBe(400)
  })

  it('fires the named ceremony, returns its typed result, and is idempotent on a same-day re-fire', async () => {
    const e = mkEnv()
    const before = await personaCount(e)

    const r1 = await call(e, 'birth', { key: ADMIN_KEY, time: String(SCHEDULED_MS) })
    expect(r1.status).toBe(200)
    const b1 = (await r1.json()) as { ceremony: string; scheduledTime: number; result: { kind: string } }
    expect(b1.ceremony).toBe('birth')
    expect(b1.scheduledTime).toBe(SCHEDULED_MS)
    expect(b1.result.kind).toBe('born') // roster-regime: no portrait ran first
    expect(await personaCount(e)).toBe(before + 1)

    // Re-fire the same scheduledTime: the ceremony's per-day-key guard holds through the actuator —
    // the second fire records no new citizen. [LAW:no-ambient-temporal-coupling]
    const r2 = await call(e, 'birth', { key: ADMIN_KEY, time: String(SCHEDULED_MS) })
    expect(r2.status).toBe(200)
    const b2 = (await r2.json()) as { result: { kind: string } }
    expect(b2.result.kind).toBe('already-born')
    expect(await personaCount(e)).toBe(before + 1)
  })

  it('defaults ?time to the wall clock read at the boundary when omitted', async () => {
    // No ?time → the route reads Date.now() at the effect boundary and fires successfully.
    const res = await call(mkEnv(), 'grace', { key: ADMIN_KEY })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ceremony: string }
    expect(body.ceremony).toBe('grace')
  })
})
