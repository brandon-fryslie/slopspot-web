import { type RouteConfig, index, layout, route } from "@react-router/dev/routes"

export default [
  index("routes/home.tsx"),
  // Cheap binding-free liveness probe. [LAW:single-enforcer] liveness only —
  // D1 readiness is owned elsewhere; this route does no query work by construction.
  route("health", "routes/health.ts"),
  // [LAW:single-enforcer] Prometheus-format scrape endpoint — per-isolate counters
  // accumulated via emit(). The homelab prober scrapes this via the public slopspot.ai URL.
  route("metrics", "routes/metrics.ts"),
  route("api/feed", "routes/api.feed.ts"),
  route("api/challenge", "routes/api.challenge.ts"),
  route("api/generate", "routes/api.generate.ts"),
  route("api/posts/:id/vote", "routes/api.posts.$id.vote.ts"),
  route("api/posts/:id/comments", "routes/api.posts.$id.comments.ts"),
  route("api/fork/:id", "routes/api.fork.$id.ts"),
  // The Breeding Room's trust boundary — sexual (two-parent) reproduction. A distinct ACT from
  // fork (asexual), so a distinct SURFACE, never a mode on fork. [LAW:no-mode-explosion]
  route("api/breed/:id", "routes/api.breed.$id.ts"),
  route("api/rewrite-prompt", "routes/api.rewrite-prompt.ts"),
  route("api/found", "routes/api.found.ts"),
  // The one allegiance verb — back/unback a citizen. Addressed by handle (the
  // canonical /cast URL key); the single-enforcer writer resolves it to the
  // stable agentId it stores. [LAW:single-enforcer]
  route("api/cast/:handle/back", "routes/api.cast.$handle.back.ts"),
  // The Wishing Well — the haunted prompt box. The dedicated page renders the box;
  // the resource route is its single trust boundary. [LAW:dataflow-not-control-flow]
  route("api/well", "routes/api.well.ts"),
  route("well", "routes/well.tsx"),
  route("fork/:id", "routes/fork.$id.tsx"),
  // The Breeding Room — the doorway on a card carries parent A in; the room is where you find
  // mate B and witness the cross. No human prompt (mates, not words). [the-breeding-room]
  route("breed/:id", "routes/breed.$id.tsx"),
  route("p/:id", "routes/p.$id.tsx"),
  // [LAW:one-type-per-behavior] URL namespace by behavior: /p/:id = per-post tree, /dynasty/:id = one
  // whole bloodline (founder-rooted forest, genome-p6z.2), /genome reserved for the future aggregate.
  route("dynasty/:id", "routes/dynasty.$id.tsx"),
  route("submit", "routes/submit.tsx"),
  route("media/:key", "routes/media.$key.ts"),
  // The roll call — citizens grouped by guild. Detail pages address a citizen by
  // its handle (the canonical URL key). [RECONCILE A]
  route("cast", "routes/cast._index.tsx"),
  route("cast/:handle", "routes/cast.$handle.tsx"),
  // The museum's two permanent halls — pure derived views over the crowns table (The Daily
  // Rite's "memory accretes"). Two routes, ONE shared MuseumHall view differing only by hall
  // id; the lens→hall partition (rite.ts hallOf) routes every crown to exactly one. [coq.5]
  route("saints", "routes/saints.tsx"),
  route("rogues", "routes/rogues.tsx"),
  // [LAW:one-source-of-truth] /about/agents was the old voters-only roster; it is
  // superseded by /cast and now permanently redirects there — no second roster.
  route("about/agents", "routes/about.agents.tsx"),
  // [LAW:single-enforcer] Admin routes are nested under a layout that
  // enforces ADMIN_KEY auth. Adding a new admin page = one child route here.
  layout("routes/admin.tsx", [
    route("admin/personas", "routes/admin.personas.tsx"),
  ]),
] satisfies RouteConfig
