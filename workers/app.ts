import { createRequestHandler } from "react-router"
import { runBankGen } from "./bank-gen"
import { runScheduled } from "~/firehose/scheduled"
import { runGenJobs, type GenJob } from "~/firehose/gen-queue"
import { runPortraitPass } from "~/agents/portrait"
import { runRite } from "~/agents/rite"
import { runBirth } from "~/agents/midwife"
import { maybeDecreeFirstPoet } from "~/agents/firstPoet"
import { runGrace } from "~/agents/grace"
import { emit } from "~/observability/metrics"
import { normalizeRoute } from "~/observability/route-normalizer"

// [LAW:single-enforcer] Cloudflare bindings (env + ctx) enter the React Router
// world here and only here. Loaders/actions read them via `context.cloudflare`.
// Anything that needs an env binding receives it through the context; nothing
// reaches outside that channel to grab a secret or a binding.
declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env
      ctx: ExecutionContext
    }
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
)

export default {
  async fetch(request, env, ctx) {
    // [LAW:single-enforcer] HTTP request and latency metrics are measured here — the single
    // place where every request enters the app. emit() buffers them; ctx.waitUntil fires
    // flushMetrics after the response so the push never adds latency to the serving path.
    const startMs = Date.now()
    const response = await requestHandler(request, {
      cloudflare: { env, ctx },
    })
    const route = normalizeRoute(new URL(request.url).pathname)
    const status = String(response.status)
    const outcome = response.status < 400 ? 'success' : 'error'
    emit('slopspot.http.request', { route, status }, 1)
    emit('slopspot.http.latency_ms', { route, outcome }, Date.now() - startMs)
    return response
  },
  // [LAW:single-enforcer] The cron entry point is here for the same reason
  // `fetch` is: this is the one place Cloudflare bindings cross into the
  // application world. Dispatch by event.cron keeps each module ignorant of
  // the other — bank-gen doesn't know the firehose exists, and vice-versa.
  // [LAW:locality-or-seam] event.cron is the discriminator; variability lives
  // in the value, not in shared state or flags.
  async scheduled(event, env, _ctx) {
    // [LAW:no-ambient-temporal-coupling] bank-gen is a BULK job (~1000 Anthropic
    // fetch() calls), so it runs in its OWN invocation. A Cloudflare invocation has
    // a finite subrequest budget (~1000 fetch()); jobs that share an invocation share
    // that budget. When bank-gen rode the 03:00 invocation it exhausted the budget
    // before the ceremonies ran, so the midwife's fetch threw "Too many subrequests"
    // and no citizen was ever born (slopspot-growing-cast-7ni.1). Its own cron =
    // its own invocation = a fresh budget; the invocation boundary owns the budget.
    if (event.cron === '0 2 * * *') {
      try {
        await runBankGen(env)
      } catch (err) {
        console.error('bank-gen: unhandled error', { cron: event.cron }, err)
      }
      return
    }
    if (event.cron === '0 3 * * *') {
      // [LAW:dataflow-not-control-flow] The daily ceremonies run as INDEPENDENT jobs,
      // each in its own catch so one's failure cannot abort the others or kill the
      // worker. They share only the trigger, not state — the portrait pass drifts the
      // Cast faces (roll-call-47p.6); the Rite crowns the city's own (the-daily-rite.md);
      // the midwife births a citizen; the First-Poet rite decrees the first poet. All
      // are LIGHT (tens of subrequests total), so they share one invocation's budget —
      // the bulk bank-gen that once starved them now runs in its own invocation (02:00).
      try {
        await runPortraitPass(env, event.scheduledTime)
      } catch (err) {
        console.error('portrait.pass: unhandled error', { cron: event.cron }, err)
      }
      try {
        await runRite(env, event.scheduledTime)
      } catch (err) {
        console.error('rite: unhandled error', { cron: event.cron }, err)
      }
      try {
        // The Growing Cast: the midwife births one new citizen a day (the-growing-cast,
        // slopspot-growing-cast-7ni.1) — folded onto the same daily tick, its own catch so a
        // failed birth cannot abort the rite/portrait/bank-gen beside it.
        await runBirth(env, event.scheduledTime)
      } catch (err) {
        console.error('birth: unhandled error', { cron: event.cron }, err)
      }
      try {
        // [LAW:dataflow-not-control-flow] The First-Poet Rite — runs UNCONDITIONALLY, AFTER the birth and
        // in its own catch, never inside the birth event. It reads STATE (is there a verse-citizen, has the
        // honor been recorded) and the data decides whether to decree — so a poet born THIS tick is marked
        // now (reading the row the birth just wrote) and a poet born before this ceremony existed is caught
        // on the next tick. Its failure cannot abort the birth/rite beside it (slopspot-beyond-image-poj.4).
        await maybeDecreeFirstPoet(env)
      } catch (err) {
        console.error('first-poet: unhandled error', { cron: event.cron }, err)
      }
      try {
        // The Patronage's Grace pass — a citizen may, rarely, choose a human (slopspot-patronage-ts7.8).
        // Folded onto the same daily tick in its OWN catch so a grace failure cannot abort the
        // rite/birth/first-poet beside it. Backings-blind by construction (lib/grace's corpus type).
        await runGrace(env, event.scheduledTime)
      } catch (err) {
        console.error('grace: unhandled error', { cron: event.cron }, err)
      }
      return
    }
    await runScheduled(event, env)
  },
  // [LAW:locality-or-seam] The generation consumer. The scheduled handler above
  // is a pure producer (enqueues GenJobs); the heavy generation work runs here,
  // on the QUEUE invocation class — a CPU/billing boundary distinct from `fetch`
  // and `scheduled`, so generation CPU never lands on a serving-class invocation.
  // Same single-enforcer reason as `fetch`/`scheduled`: bindings cross into the
  // app world here and only here. max_concurrency:1 (wrangler.jsonc) makes the
  // sequential anti-rep guarantee an explicit queue-config invariant.
  async queue(batch, env, _ctx) {
    await runGenJobs(batch, env)
  },
} satisfies ExportedHandler<Env, GenJob>
