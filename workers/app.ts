import { createRequestHandler } from "react-router"
import { runBankGen } from "./bank-gen"
import { runScheduled } from "~/firehose/scheduled"
import { runGenJobs, type GenJob } from "~/firehose/gen-queue"
import { CEREMONIES } from "~/agents/ceremonies"
import { emit } from "~/observability/metrics"
import { flushMetrics } from "~/db/metric-counters"
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
    // Drain this isolate's metric buffer to D1 AFTER the response is sent, so the durable
    // /metrics view is complete without adding latency to the serving path. [LAW:effects-at-boundaries]
    ctx.waitUntil(flushMetrics(env))
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
    } else if (event.cron === '0 3 * * *') {
      // [LAW:dataflow-not-control-flow][LAW:one-source-of-truth] Ceremonies are INDEPENDENT
      // jobs — each in its own catch so one's failure cannot abort the others or kill the
      // worker. The ordered list lives in ~/agents/ceremonies; dispatch, tests, and the
      // staging actuator all loop the same registry.
      for (const ceremony of CEREMONIES) {
        try {
          await ceremony.run(env, event.scheduledTime)
        } catch (err) {
          console.error(`${ceremony.name}: unhandled error`, { cron: event.cron }, err)
        }
      }
    } else {
      await runScheduled(event, env)
    }
    // [LAW:no-silent-failure] Drain this invocation's metric buffer to D1 so cron/ceremony
    // metrics (firehose.fire, post.created, grace/rite/birth …) survive the isolate teardown
    // and the next /metrics scrape — served by ANY isolate — sees them. Before this they
    // accumulated in the scheduled isolate's in-memory buffer and were never collected.
    // Awaited (not waitUntil): cron is not latency-sensitive and the flush must finish
    // before the invocation ends.
    await flushMetrics(env)
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
    // [LAW:no-silent-failure] Generation runs on the QUEUE invocation class, so its metrics
    // (post.created, provider.*, composer.result, write.batch_outcome) accumulate in THIS
    // isolate's buffer — invisible to the scrape until flushed. Drain to D1 here, same as
    // the scheduled handler.
    await flushMetrics(env)
  },
} satisfies ExportedHandler<Env, GenJob>
