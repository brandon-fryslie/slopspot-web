import { type RouteConfig, index, layout, route } from "@react-router/dev/routes"

export default [
  index("routes/home.tsx"),
  route("api/feed", "routes/api.feed.ts"),
  route("api/challenge", "routes/api.challenge.ts"),
  route("api/generate", "routes/api.generate.ts"),
  route("api/posts/:id/vote", "routes/api.posts.$id.vote.ts"),
  route("api/posts/:id/comments", "routes/api.posts.$id.comments.ts"),
  route("api/fork/:id", "routes/api.fork.$id.ts"),
  route("api/found", "routes/api.found.ts"),
  route("fork/:id", "routes/fork.$id.tsx"),
  route("p/:id", "routes/p.$id.tsx"),
  route("submit", "routes/submit.tsx"),
  route("media/:key", "routes/media.$key.ts"),
  // [LAW:single-enforcer] Admin routes are nested under a layout that
  // enforces ADMIN_KEY auth. Adding a new admin page = one child route here.
  layout("routes/admin.tsx", [
    route("admin/personas", "routes/admin.personas.tsx"),
  ]),
] satisfies RouteConfig
