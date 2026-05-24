// [LAW:types-are-the-program] This file is the program. Posts, Content, Generation,
// Media, and Origin are the entire domain — everything else in the codebase is residue
// derived from these. Adding a content type or origin actor is a one-variant change here
// and a structural pattern-match downstream. No bag-of-optionals, no nullable
// discriminators.

import type { AspectRatio, RecipeSubject, StyleFamily } from './variety'

export type { AspectRatio, RecipeSubject, StyleFamily } from './variety'

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

// [LAW:types-are-the-program] A Generation is a recipe. Three categories of
// field:
//
//   1. Provider-specific (`params: unknown`): the plugin owns this schema and
//      validates at its trust boundary. `providerVersion` pins the schema so
//      old posts remain interpretable when a provider revises their API.
//   2. Canonical-across-providers (`aspectRatio`, `styleFamily`, `subject`):
//      these are part of the variety taxonomy, not provider input. Lifted out
//      of `params` (where `aspectRatio` previously lived for fal-flux) so a
//      single canonical representation flows across all providers. Each
//      provider translates `aspectRatio` to its native shape at its own
//      boundary. [LAW:single-enforcer]
//   3. Lineage (`parentId?`): set on forks, undefined otherwise.
//
// `styleFamily`/`aspectRatio`/`subject` are required (not optional) — every
// Content.kind === 'generation' row carries them by construction. User uploads
// use the upload Content variant which doesn't carry a recipe at all, so the
// "what about non-generations" question doesn't apply here.
export type Generation = {
  providerId: ProviderId
  providerVersion: string
  params: unknown
  styleFamily: StyleFamily
  aspectRatio: AspectRatio
  subject: RecipeSubject
  parentId?: PostId
}

// [LAW:types-are-the-program] Generation is async. `output` only exists in the
// `succeeded` variant; in-progress and failed states cannot accidentally be treated
// as if they had media. PostCard's render is forced to handle every variant by the
// compiler — no fallback branches.
export type GenerationStatus =
  | { kind: 'pending'; queuedAt: Date }
  | { kind: 'running'; startedAt: Date }
  | { kind: 'succeeded'; output: Media; completedAt: Date }
  | { kind: 'failed'; reason: string; failedAt: Date }

// [LAW:types-are-the-program] Forkability is structural, not a nullable field. Only
// `kind: 'generation'` carries a recipe; uploads are raw bytes. The compiler refuses
// to fork an upload.
export type Content =
  | { kind: 'generation'; recipe: Generation; status: GenerationStatus }
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

// [LAW:one-source-of-truth] Post carries no score. Votes are the source of truth;
// score is a derived sum and lives on FeedItem (computed by the seed today, by a
// D1 JOIN tomorrow). A `score: number` field on Post would be a second representation
// that can drift from the votes table — exactly what one-source-of-truth forbids.
export type Post = {
  id: PostId
  createdAt: Date
  content: Content
  origin: Origin
}

// [LAW:types-are-the-program] FeedItem is the smooth boundary between the data layer
// (seed today, D1 tomorrow) and rendering. Score and rank are derived per-query — same
// shape regardless of source. The feed reader fills the slot; the consumer reads the
// slot. The seam IS the type.
export type FeedItem = {
  post: Post
  score: number
  rank: number
}
