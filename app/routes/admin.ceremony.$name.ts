import type { Route } from "./+types/admin.ceremony.$name"
import { requireAdmin } from "~/lib/admin-auth"
import { CEREMONIES } from "~/agents/ceremonies"

// [LAW:single-enforcer] The redeemed manual trigger (slopspot-ceremony-test-0zy.4): the
// AUTOMATED actuator the ceremony-smoke suite (.5) drives against the running staging worker.
// Staging's wrangler env carries crons:[] deliberately — nothing fires on a clock there — so
// this route is how a deploy-time prober makes a named ceremony run on demand and reads back
// its outcome. It is NOT a human's debug button.
//
// [LAW:one-source-of-truth] It fires ONE ceremony from the same CEREMONIES registry that the
// prod cron (workers/app.ts) and the in-isolate dispatch test (.3) loop. That array is the only
// enumeration of ceremonies; this route reuses it and never re-lists the names.
//
// Verification order (outermost first — each gate fails closed before the next runs):
//   1. SLOPSPOT_ENV must be 'dev' (staging + local dev) → else 404. The OUTERMOST gate, so prod
//      presents the route as nonexistent: it can never be poked, and never even reveals that
//      admin auth lives here. (Same env discriminator realProviders()/haiku.ts read.)
//   2. POST only → else 405 (firing a ceremony is a state change).
//   3. requireAdmin (reused unchanged) → throws 401 on a bad/absent key. The epic's acceptance
//      prose said "403"; the single enforcer returns 401 Unauthorized — the correct status for
//      missing credentials — and reusing it unchanged outranks the prose. [LAW:single-enforcer]
//   4. :name must be a member of the registry → else 404. CEREMONIES.find IS the exhaustive
//      membership check over CeremonyName (the union is derived from this array), so there is no
//      second name list to drift. [LAW:one-source-of-truth][LAW:dataflow-not-control-flow]
//   5. ?time=<unix-ms> optional; the clock is read HERE, at the effect boundary — the ceremony
//      cores stay clockless. [LAW:effects-at-boundaries] A provided-but-non-integer override is
//      rejected 400 rather than fed downstream as NaN. [LAW:no-silent-failure]
//
// [LAW:single-enforcer] No flushMetrics here: this rides the `fetch` invocation, whose boundary
// (workers/app.ts) already drains the metric buffer in ctx.waitUntil after the response — so a
// ceremony's emits reach durable D1 without a second, competing flusher.
//
// PORTRAIT CAVEAT (see .5): portrait renders each citizen through persona.medium, a REAL provider,
// so firing it on staging spends real provider cost. Re-mediuming staging personas to their -mock
// siblings is the smoke suite's concern (test DATA); the actuator fires the real ceremony faithfully.
// [LAW:effects-at-boundaries]

export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env

  // 1. Outermost: the route does not exist outside dev/staging.
  if (env.SLOPSPOT_ENV !== "dev") {
    return Response.json({ error: "not found" }, { status: 404 })
  }

  // 2. Firing a ceremony is a state change.
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 })
  }

  // 3. Admin gate — reused unchanged; throws 401 on a bad/absent key.
  await requireAdmin(request, env)

  // 4. Resolve the named ceremony against the single registry.
  const ceremony = CEREMONIES.find((c) => c.name === params.name)
  if (!ceremony) {
    return Response.json({ error: `unknown ceremony: ${params.name}` }, { status: 404 })
  }

  // 5. Read the clock at the boundary; reject a garbage override loudly.
  const timeParam = new URL(request.url).searchParams.get("time")
  const scheduledTime = timeParam === null ? Date.now() : Number(timeParam)
  if (!Number.isInteger(scheduledTime)) {
    return Response.json(
      { error: "time must be an integer unix-ms timestamp" },
      { status: 400 },
    )
  }

  // Fire the one ceremony and report its typed result. A thrown ceremony is surfaced loudly
  // (500 + detail), never swallowed — the smoke prober must see a failed pass as a failure.
  // [LAW:no-silent-failure]
  try {
    const result = await ceremony.run(env, scheduledTime)
    return Response.json({ ceremony: ceremony.name, scheduledTime, result }, { status: 200 })
  } catch (e) {
    console.error(`admin.ceremony: ${ceremony.name} failed`, { scheduledTime }, e)
    return Response.json(
      {
        error: `ceremony ${ceremony.name} failed`,
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    )
  }
}
