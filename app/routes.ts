import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  index("routes/home.tsx"),
  route("api/challenge", "routes/api.challenge.ts"),
  route("api/generate", "routes/api.generate.ts"),
  route("api/posts/:id/vote", "routes/api.posts.$id.vote.ts"),
  route("api/posts/:id/comments", "routes/api.posts.$id.comments.ts"),
  route("api/fork/:id", "routes/api.fork.$id.ts"),
  route("fork/:id", "routes/fork.$id.tsx"),
  route("media/:key", "routes/media.$key.ts"),
] satisfies RouteConfig
