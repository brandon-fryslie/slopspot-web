import { createRequestHandler } from "react-router"
import { runBankGen } from "./bank-gen"
import { runScheduled, runAgentPass } from "~/firehose/scheduled"

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
    return requestHandler(request, {
      cloudflare: { env, ctx },
    })
  },
  // [LAW:single-enforcer] The cron entry point is here for the same reason
  // `fetch` is: this is the one place Cloudflare bindings cross into the
  // application world. Dispatch by event.cron keeps each module ignorant of
  // the other — bank-gen doesn't know the firehose exists, and vice-versa.
  // [LAW:locality-or-seam] event.cron is the discriminator; variability lives
  // in the value, not in shared state or flags.
  async scheduled(event, env, _ctx) {
    if (event.cron === '0 3 * * *') {
      // Top-level catch mirrors runScheduled's pattern: keep the worker alive
      // even when bank-gen throws (missing secret, KV failure, etc.).
      try {
        await runBankGen(env)
      } catch (err) {
        console.error('bank-gen: unhandled error', { cron: event.cron }, err)
      }
      return
    }
    // [LAW:locality-or-seam] Discovery cron fires every 12h. runAgentPass owns
    // the persona-pick + role dispatch; this site is the binding-pass only.
    if (event.cron === '0 */12 * * *') {
      try {
        await runAgentPass(env, event.scheduledTime, 'discoverer')
      } catch (err) {
        console.error('discovery-pass: unhandled error', { cron: event.cron }, err)
      }
      return
    }
    await runScheduled(event, env)
  },
} satisfies ExportedHandler<Env>
