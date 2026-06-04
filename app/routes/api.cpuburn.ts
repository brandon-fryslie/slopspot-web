// Synthetic CPU-burn affordance — a TEST AFFORDANCE, not a product path.
//
// E4b's closed-loop alarm test (slopspot-efficiency-a5w.5.2) drives this route to push
// a known route's p95 CPU past its budget, proving the regression -> metric -> alarm ->
// operator loop fires. The burn is a busy-loop (CPU, not sleep) so it shows up as real
// cpuTime in the TraceItem the tail consumer measures.
//
// [LAW:single-enforcer] Gated in exactly one place: this route is the only burn surface.
// It refuses to burn when SLOPSPOT_ENV === 'prod', so the production deploy cannot be
// driven to waste CPU. [LAW:dataflow-not-control-flow] the gate selects the burn DURATION
// (0ms in prod, the requested ms otherwise) — the same loop always runs over that data,
// rather than branching around the operation.
import type { Route } from './+types/api.cpuburn'

// Bound the burn so a typo'd query param can't wedge an isolate near the CPU limit.
const MAX_BURN_MS = 200

const parseBurnMs = (raw: string | null): number => {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_BURN_MS) : 0
}

export function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const requested = parseBurnMs(new URL(request.url).searchParams.get('ms'))
  // In prod the requested duration collapses to 0 — the loop runs zero iterations.
  const budgetMs = env.SLOPSPOT_ENV === 'prod' ? 0 : requested

  const deadline = Date.now() + budgetMs
  let spins = 0
  while (Date.now() < deadline) spins++

  return Response.json({ burnedMs: budgetMs, spins })
}
