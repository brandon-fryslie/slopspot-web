// [LAW:types-are-the-program] This file is the program. Posts, Content, Generation,
// Media, and Origin are the entire domain — everything else in the codebase is residue
// derived from these. Adding a content type or origin actor is a one-variant change here
// and a structural pattern-match downstream. No bag-of-optionals, no nullable
// discriminators.

declare const Brand: unique symbol
type Branded<T, B extends string> = T & { readonly [Brand]: B }

export type PostId = Branded<string, 'PostId'>
export type UserId = Branded<string, 'UserId'>
export type AgentId = Branded<string, 'AgentId'>
export type ProviderId = Branded<string, 'ProviderId'>

export const PostId = (s: string): PostId => s as PostId
export const UserId = (s: string): UserId => s as UserId
export const AgentId = (s: string): AgentId => s as AgentId
export const ProviderId = (s: string): ProviderId => s as ProviderId

// [LAW:one-source-of-truth] Media is reused as both `generation.output` and `upload.asset`.
// One type, two contexts — adding `audio` is a single-line change visible everywhere.
export type Media =
  | { kind: 'image'; url: string; w: number; h: number; alt?: string }
  | { kind: 'video'; url: string; durationMs: number; thumbnailUrl?: string }
  | { kind: 'text'; body: string }
  | { kind: 'audio'; url: string; durationMs: number }

// A Generation is a recipe. `params` is `unknown` here on purpose: the provider plugin
// owns the params schema and validates at the boundary. `providerVersion` pins the
// schema so old posts remain interpretable when a provider revises their API.
export type Generation = {
  providerId: ProviderId
  providerVersion: string
  params: unknown
  parentId?: PostId
}

// [LAW:types-are-the-program] Forkability is structural, not a nullable field. Only
// `kind: 'generation'` carries a recipe; uploads are raw bytes. The compiler refuses
// to fork an upload.
export type Content =
  | { kind: 'generation'; recipe: Generation; output: Media }
  | { kind: 'upload'; asset: Media }

export type Actor =
  | { kind: 'user'; userId: UserId }
  | { kind: 'agent'; agentId: AgentId }

// `onBehalfOf` captures real delegation (agent acting for a user, etc.). Depth-1 by
// design: deeper delegation chains are not a use case anyone wants to render.
export type Origin = {
  actor: Actor
  onBehalfOf?: Actor
}

export type Post = {
  id: PostId
  createdAt: Date
  score: number
  content: Content
  origin: Origin
}
