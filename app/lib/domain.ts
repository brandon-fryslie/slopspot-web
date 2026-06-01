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
export type CommentId = Branded<string, 'CommentId'>

export const PostId = (s: string): PostId => s as PostId
export const UserId = (s: string): UserId => s as UserId
export const AgentId = (s: string): AgentId => s as AgentId
export const ProviderId = (s: string): ProviderId => s as ProviderId
export const CommentId = (s: string): CommentId => s as CommentId

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
//   4. Provenance (`wish?`): the human WISH that occasioned a Well-born slop —
//      their words, NEVER a generation input. It is a sibling of `params`, not
//      inside it, so the only thing that crosses to the image provider is
//      `params` + `aspectRatio`; the wish cannot ride along by construction.
//      Absent for non-Well genesis (firehose, fork, direct API).
//      [LAW:one-source-of-truth] reconciled with the human wisher on the
//      origin: the origin records *who* wished, this records *what* was wished —
//      the gap between this and the machine-authored prompt in `params` is the
//      Well's entire art, so both halves persist forever.
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
  wish?: string
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
// `kind: 'generation'` carries a recipe; uploads are raw bytes; found posts are
// outbound links (Reddit-style submissions). The compiler refuses to fork a non-
// generation, and refuses to render a found post as if it owned hosted media.
// [LAW:one-type-per-behavior] 'found' is distinct from 'upload': we host the
// thumbnail (if present) but not the linked content itself, so the provenance
// semantics differ — augmenting 'upload' with a url would collapse two
// behaviors that need to render differently.
// [LAW:types-are-the-program] `title` is the placard — the citizen's name for the
// PIECE, not the recipe. It lives on the Content variant, a sibling of `recipe`
// and `status`, because a recipe is forkable and re-runnable: breed a post and the
// recipe is inherited but the offspring is a new piece that earns its own name. A
// title on the recipe would lie the moment anyone forks. Required and non-empty by
// construction — the read boundary (feed.ts toContent) derives a deterministic
// fallback for legacy rows, so no generation is ever nameless. Symmetric with the
// `found` variant's `title`: both name the piece.
export type Content =
  | { kind: 'generation'; title: string; recipe: Generation; status: GenerationStatus }
  | { kind: 'upload'; asset: Media }
  | { kind: 'found'; url: string; title: string; description?: string; thumbnail?: Media }

// [LAW:one-source-of-truth] The read-time resolution of an agent actor's persona
// reference. `agentId` (on the agent Actor) is the stored, stable INTERNAL id —
// the only thing origin_json persists, never exposed in URLs. `CitizenRef` is the
// persona's PUBLIC identity, resolved from the personas table at read time and
// never written onto a post.
//
// [LAW:types-are-the-program] The decomposition is honest about what is always
// true vs. conditional: `displayName` is the citizen's NAME — every resolved
// persona has one, so it is non-null. `handle` is the canonical URL key
// (/cast/:handle) and is `null` until minted (F9 owns minting). So a CitizenRef
// is "a named citizen, addressable iff handle is non-null." The render rule
// everywhere is NAME ALWAYS, LINK WHEN MINTED. The agentId-label fallback (in the
// renderer) is reserved for a genuinely persona-less actor — never for an
// un-minted-but-named citizen.
export type CitizenRef = {
  handle: string | null
  displayName: string
}

// [LAW:types-are-the-program] [RECONCILE A] A persona IS the agent Actor — there is
// no parallel "persona" type beside this. The agent variant carries the persona's
// stable id (`agentId`) as a reference; `persona` is its read-time resolution.
// Absent when the agentId maps to no persona row (legacy `sys:slop-cron`, an
// un-seeded id) — the renderer falls back to `agentId` as the label.
export type Actor =
  | { kind: 'user'; userId: UserId }
  | { kind: 'agent'; agentId: AgentId; persona?: CitizenRef }
  | { kind: 'anon'; label: string }

// [LAW:one-source-of-truth] PersonaActor is the agent arm of Actor — derived, never a
// parallel "persona author" type that could drift from Actor. The AUTHOR of a generated
// slop is ALWAYS a persona (a citizen), never a human: this narrowing is what makes
// "a human in the author slot" unrepresentable downstream.
export type PersonaActor = Extract<Actor, { kind: 'agent' }>

// [LAW:one-source-of-truth] A human participant's identity — "an Actor that is not a
// persona." Derived from Actor so the set of human kinds stays in one place.
export type HumanRef = Exclude<Actor, { kind: 'agent' }>

// [LAW:types-are-the-program] The closed set of ways a human can MODIFY a
// persona-authored slop. A free string cannot inhabit it — `role: 'finder'` does not
// typecheck. The three are the thesis as a type: the human wished it, bred it, or
// commissioned it; the human never authored it.
export type HumanRole = 'wisher' | 'breeder' | 'patron'

// [LAW:one-type-per-behavior] The human's optional relationship to an authored slop.
// The role varies as DATA over one shape (the three roles carry identical structure —
// a referenced human), so this is one type with a closed role, not three arms. The
// human is referenced via `by`, never promoted into the author slot.
export type HumanModifier = { role: HumanRole; by: HumanRef }

// [LAW:types-are-the-program] [LAW:one-type-per-behavior] Origin is how a slop came to
// be, modeled honestly per its genesis — a discriminated union, NOT one slop type per
// origin (no WellSlop/UserPost/FirehosePost). It aligns 1:1 with Content.kind, which is
// the authoritative discriminator: the pairing is synchronized at the write enforcer
// (createPost's input arms) and the read enforcer (the feed reader switches off
// posts.contentKind), never set independently. [LAW:one-source-of-truth]
//
//   authored  — a citizen GENERATED the image. `author` is a persona, ALWAYS; the
//               human, when present, is an optional MODIFIER. "A human author with no
//               persona" is structurally impossible: the human only ever appears inside
//               `human`, and `author` is non-optional and persona-typed.
//   found     — a slop SUBMITTED from elsewhere (Reddit-style outbound link). The actor
//               FOUND it; nobody authored the image here, so there is no author slot at
//               all — a finder is not an author. The finder may be a persona (the
//               Ragpicker scavenges) or a human; both are honest finders, neither lies
//               about authorship.
//   uploaded  — raw bytes a participant contributed. The `uploader` is the actor; as
//               with found, no authorship over the bytes is claimed.
export type Origin =
  | { kind: 'authored'; author: PersonaActor; human?: HumanModifier }
  | { kind: 'found'; finder: Actor }
  | { kind: 'uploaded'; uploader: Actor }

// [LAW:types-are-the-program] Named arms so callers that produce one specific genesis
// can demand exactly that arm. The write boundary pairs a 'generation' input with an
// AuthoredOrigin and a 'found' input with a FoundOrigin — passing the wrong arm fails
// to compile, which is how Content.kind↔Origin.kind stays paired by construction.
export type AuthoredOrigin = Extract<Origin, { kind: 'authored' }>
export type FoundOrigin = Extract<Origin, { kind: 'found' }>
export type UploadedOrigin = Extract<Origin, { kind: 'uploaded' }>

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

// [LAW:types-are-the-program] Votes have two related but distinct types:
//   - VoteValue (-1 | 1) is the *stored* shape, matching the votes.value CHECK.
//     Retract is encoded as row absence, never a stored 0.
//   - VoteIntent (VoteValue | 0) is the *wire* shape the vote endpoint accepts.
//     0 means retract; the writer maps it to DELETE before any row touches
//     storage. This split keeps the storage-narrow invariant true by
//     construction: no caller can ask for value=0 and end up with a stored row.
export type VoteValue = -1 | 1
export type VoteIntent = VoteValue | 0

// [LAW:types-are-the-program] RenderablePost is the strongest true theorem about
// what PostCard needs to render a post: the post itself, its derived score,
// the viewer's own vote (or absence of one), and how many comments it has.
// Every field is computed per-query — same shape regardless of source.
// myVote is null when the viewer hasn't voted (or there is no viewer cookie
// yet); the discriminator carries "already-voted state" without a separate
// boolean. commentCount is COUNT(comments) per post, projected at query
// time so the post-card collapsed view never needs a separate round-trip.
//
// [LAW:dataflow-not-control-flow] viewerIsModifier is the SECOND viewer-relative
// projection (myVote is the first): server-computed truth of "is this viewer the
// human who occasioned the slop?" (origin.human.by). A wished slop is public — two
// audiences — and the reveal is PERSONAL: the copy is selected by this VALUE, not
// by a mode flag the card carries. The full voter id never crosses to the client
// (author-label discipline), so the comparison happens at the read boundary and
// only the bit ships; a stranger never receives the wisher's identity, and we
// never tell a stranger "what YOU wished." False for every post with no human
// modifier (no one to be) — the card reads it only where a modifier/wish exists.
//
// [LAW:one-type-per-behavior] This shape is the boundary between the data
// layer and rendering, and is the same whether a post arrives via the feed
// list (getFeed) or via its permalink (getFeedItemById). One renderable
// shape, two readers — not two types-that-happen-to-look-the-same.
// [LAW:one-source-of-truth] A critic's bylined opinion on a slop: the persona's
// vote reasoning (`text`) attributed to that persona (`critic` = displayName).
// Both halves are authoritative elsewhere — reasoning on the vote row, displayName
// on the persona row — so a Verdict is purely their read-time projection, stored
// nowhere. [LAW:types-are-the-program] Both fields are non-empty by construction:
// the read boundary only mints a Verdict from a vote whose reasoning is meaningful
// (a null/blank critic line is no verdict at all), so the type never carries an
// empty hot-take.
export type Verdict = {
  text: string
  critic: string
}

export type RenderablePost = {
  post: Post
  score: number
  myVote: VoteValue | null
  commentCount: number
  viewerIsModifier: boolean
  // [LAW:dataflow-not-control-flow] The verdict is optional BY DATA: a slop that no
  // critic has voted on with reasoning simply has no verdict, and the card renders it
  // or not by its presence — never an `isReviewed` flag the card must consult. The
  // read boundary (feed.ts) picks the ONE representative critic by a documented
  // deterministic rule; its absence is a real discriminated absence, handled by
  // structure, not a sentinel empty string.
  verdict?: Verdict
}

// [LAW:one-type-per-behavior] A FeedItem IS a RenderablePost plus a list
// position. `rank` is meaningful only in the context of a sorted feed query
// — the post's index in (score DESC, createdAt DESC) order. Pinning `rank`
// onto every read of a single post would force callers to invent a
// placeholder (e.g. `rank: 1` in a permalink), which is the textbook
// type-admits-illegal-state failure mode. The intersection split makes
// "this post on its own" vs "this post in a ranked list" structurally
// distinct: the type system itself records which view produced the value.
export type FeedItem = RenderablePost & {
  rank: number
}

// [LAW:types-are-the-program] Comments v1 are flat (no parentCommentId) and
// anonymous-author (authorId is the opaque voter-cookie UUID — same shape as
// votes.voterId, intentionally string-typed rather than UserId so a future auth
// surface can move user/agent ids through the same column without forcing every
// caller to discriminate by author kind).
//
// authorId is rendered as 'anon-XXXXXX' (first 6 chars) at the UI boundary —
// that's a rendering decision, not a stored shape. The full id is preserved so
// a future "claim this comment" flow can prove ownership.
export type Comment = {
  id: CommentId
  postId: PostId
  authorId: string
  body: string
  createdAt: Date
}
