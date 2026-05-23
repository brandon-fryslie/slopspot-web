import { createRequestHandler } from "react-router"
import { runScheduled } from "~/firehose/scheduled"

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
    // [LAW:no-mode-explosion] exception: wrangler's --test-scheduled injects a
    // bundler middleware that maps GET /__scheduled to scheduled(); that
    // middleware is skipped when our worker bundle is built by the RR7
    // Cloudflare vite plugin instead of by wrangler. We mirror the contract
    // here so `pnpm dev` can fire the cron locally via `curl /__scheduled`.
    // `import.meta.env.DEV` is a vite compile-time constant — the branch is
    // dead code in every non-dev build (production AND `wrangler dev`, which
    // consumes the production bundle), so /__scheduled is unreachable on
    // workers.dev / slopspot.ai. Exit plan: drop this when upstream supports
    // vite-built workers via the wrangler --test-scheduled middleware.
    if (import.meta.env.DEV) {
      const url = new URL(request.url)
      if (url.pathname === "/__scheduled") {
        // [LAW:types-are-the-program] Separate "absent" from "present-but-junk"
        // explicitly. `Number(x) || Date.now()` collapses both into "falsy →
        // fall back", which silently rejects valid `time=0` (Unix epoch) and
        // masks malformed input. Accept set: any finite number, including 0
        // and negatives. Reject set: missing param OR non-finite parse —
        // both fall back to `Date.now()`.
        const rawTime = url.searchParams.get("time")
        const parsedTime = rawTime === null ? NaN : Number(rawTime)
        await runScheduled(
          {
            scheduledTime: Number.isFinite(parsedTime) ? parsedTime : Date.now(),
            cron: url.searchParams.get("cron") ?? "* * * * *",
            noRetry: () => {},
          } satisfies ScheduledController,
          env,
        )
        return new Response("scheduled fired\n", { status: 200 })
      }
    }
    return requestHandler(request, {
      cloudflare: { env, ctx },
    })
  },
  // [LAW:single-enforcer] The cron entry point is here for the same reason
  // `fetch` is: this is the one place Cloudflare bindings cross into the
  // application world. The orchestration lives in `~/firehose/scheduled` so
  // this file stays a thin binding-pass and never grows ad-hoc cron logic.
  async scheduled(event, env, _ctx) {
    await runScheduled(event, env)
  },
} satisfies ExportedHandler<Env>
