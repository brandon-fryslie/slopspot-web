import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  index("routes/home.tsx"),
  route("api/challenge", "routes/api.challenge.ts"),
  route("api/generate", "routes/api.generate.ts"),
  route("media/:key", "routes/media.$key.ts"),
] satisfies RouteConfig
