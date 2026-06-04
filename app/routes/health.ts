// Liveness probe. Returns 200 with a trivial body and touches NO Cloudflare
// binding — no D1, no R2, no env. This is load-bearing: a health check that
// replicated the feed read would re-introduce the very cost it exists to avoid.
//
// [LAW:single-enforcer] One concern per endpoint — this is liveness only, not a
// D1 readiness ping. D1 reachability is already covered by the apex slopspot.ai
// probe plus the SlopSpot5xx rule; a second reachability check here would be a
// duplicate enforcer that drifts.
// [LAW:dataflow-not-control-flow] A liveness route has no variability to branch
// on: "if reachable then 200" is the wrong shape. The same operation runs every
// invocation — construct a 200 — with no data and no condition. The loader takes
// no args precisely so it CANNOT reach a binding.
export function loader() {
  return new Response("ok", { status: 200 })
}
