import { createRequestHandler } from "react-router"
import { runBankGen } from "./bank-gen"
import { runScheduled } from "~/firehose/scheduled"
import { runGenJobs, type GenJob } from "~/firehose/gen-queue"
import { runPortraitPass } from "~/agents/portrait"
import { runRite } from "~/agents/rite"
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
    if (event.cron === '0 3 * * *') {
      // [LAW:dataflow-not-control-flow] The daily cron runs INDEPENDENT jobs, each
      // in its own catch so one's failure cannot abort the others or kill the
      // worker. They share only the trigger, not state — bank-gen refills the
      // challenge bank; the portrait pass drifts the Cast faces (roll-call-47p.6);
      // the Rite crowns the city's own (the-daily-rite.md). All folded onto the
      // existing daily tick rather than a parallel scheduler.
      try {
        await runBankGen(env)
      } catch (err) {
        console.error('bank-gen: unhandled error', { cron: event.cron }, err)
      }
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
