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
// [LAW:types-are-the-program] A GenomeId is NOT a PostId. The genome (heritable code) and the
// phenotype (the post + its rendered Media) are distinct concepts — the split System III opens
// for non-pixel art. In L1 a genome maps 1:1 to its generation post, so a GenomeId's VALUE is
// the post's id; the distinct BRAND keeps the two from being conflated in code.
export type GenomeId = Branded<string, 'GenomeId'>

export const PostId = (s: string): PostId => s as PostId
export const UserId = (s: string): UserId => s as UserId
export const AgentId = (s: string): AgentId => s as AgentId
export const ProviderId = (s: string): ProviderId => s as ProviderId
export const CommentId = (s: string): CommentId => s as CommentId
export const GenomeId = (s: string): GenomeId => s as GenomeId

// [LAW:one-source-of-truth] Media is reused as both `generation.output` and `upload.asset`.
// One type, two contexts — adding `audio` is a single-line change visible everywhere.
export type Media =
  | { kind: 'image'; url: string; w: number; h: number; alt?: string }
  | { kind: 'video'; url: string; durationMs: number; thumbnailUrl?: string }
  | { kind: 'text'; body: string }
  | { kind: 'audio'; url: string; durationMs: number }

// [LAW:types-are-the-program] A slop is a PHENOTYPE rendered from a heritable GENOME. The
// Genome is the old flat recipe re-seen as heritable code (design-docs/the-genome.md +
// the-genome-l1-proposal.md). It is exactly four things and the image is NOT one of them — the
// phenotype is rendered FROM the genome and is never part of it (you cannot inherit a body).

// [LAW:types-are-the-program] GENES — the discrete categorical heredity, inherited as whole
// alleles, crossed over per-gene at breeding (L2). These ARE the old recipe fields, re-seen as
// genes; each canonical (not provider input) — the provider translates `frame` to its native
// shape at its own boundary. [LAW:single-enforcer]
export type Genes = {
  species: StyleFamily // the deepest gene; crossing it makes a hybrid
  form: RecipeSubject // the body plan: subject template + filled slots
  frame: AspectRatio
  medium: ProviderId // [RECONCILE C] the author-citizen's medium
}

// [LAW:types-are-the-program] TRAITS — the continuous heritable dials (the substrate of drift).
// A FIXED-KEY record, not number[] — a named record forbids a wrong-dimension vector by
// construction (the same reason `bred` below is a 2-tuple). Exactly four axes, each bipolar,
// [0,1], 0.5 neutral. Inert in L1 (carried, not yet read); the composer reads them in L2, they
// drift in L3. The axis NAMES live here; the STEERING SEMANTICS (density = population of the
// frame, not ornament; earnestness must push AGAINST the house ironic register) live in ONE
// place — the composer's trait→bias translation (L2) — never as WHAT-comments here that would
// drift. [LAW:single-enforcer]
// `paletteBias` is deliberately absent: warmth is a colour GRADE downstream of these axes
// (baroque+sincere runs warm), so a warmth field would be a second source of truth for warmth.
// [LAW:one-source-of-truth]
// RESERVED — `resolution` (resolved↔shadowed): NOT a field in L1. Held back by the SAME rule
// that keeps Media off the Genome — the genome may only hold what something in the system can
// actually express or pass. A field with no expressor is as illegal as a heritable phenotype;
// resolution earns its place when Media opens to non-pixel phenotypes (System III). Named, not
// poured. [LAW:types-are-the-program]
export type TraitVector = {
  austerity: number // austere(0) ↔ baroque(1)
  curse: number // clean(0) ↔ cursed(1)
  density: number // sparse(0) ↔ dense(1) — population of the frame
  earnestness: number // ironic(0) ↔ sincere(1)
}

// [LAW:types-are-the-program] LINEAGE — the heredity record, a DAG node. The discriminator IS
// the mode of reproduction: founder = SPONTANEOUS (the firehose seeds a fresh genome from the
// primordial pool), single = ASEXUAL (one parent, mutated — the classic fork / firehose-fresh-
// from-a-seed), bred = SEXUAL (two parents, crossover — L2). `bred` is a 2-TUPLE, so "a bred
// child has exactly two parents" holds by construction; illegal arities (0/1/3+ parents on a
// cross) are unrepresentable. Assembled at the read boundary from the lineage_edges edge COUNT.
export type Lineage =
  | { kind: 'founder' }
  | { kind: 'single'; parent: GenomeId }
  | { kind: 'bred'; parents: readonly [GenomeId, GenomeId] }

// [LAW:types-are-the-program] The heritable genome — exactly genes + utterance + traits +
// lineage. NO Media/params/providerVersion/wish: those are the render event + provenance
// (GenerationRender), not heritable code. The UTTERANCE is the soft tissue — the composed
// prompt, heritable by blend+drift (L2), promoted here from inside `params`. `id` makes the
// genome a complete DAG node (its value is the post id in L1).
export type Genome = {
  id: GenomeId
  genes: Genes
  utterance: string
  traits: TraitVector
  lineage: Lineage
}

// [LAW:types-are-the-program] How a phenotype was RENDERED from a genome, plus provenance —
// NOT heritable. `params` is the provider-native config, derived from genome+seed and stored as
// provenance of what was actually sent (it carries the seed; full derive-at-render is a later
// layer). `providerVersion` pins the provider schema at render time so old posts stay
// interpretable. `wish` is the human WISH that occasioned a Well-born genome's utterance — the
// origin records *who* wished, this records *what* was wished; the gap between the wish and the
// machine-authored utterance is the Well's whole art. Absent for non-Well genesis. Never
// heritable: a bred child has no wish. [LAW:one-source-of-truth]
export type GenerationRender = {
  providerVersion: string
  params: unknown
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
// PIECE, not the genome. It lives on the Content variant, a sibling of `genome`,
// `render`, and `status`, because a genome is heritable and re-runnable: breed a slop and
// the genome is inherited but the offspring is a new piece that earns its own name. A
// title on the genome would lie the moment anyone breeds. Required and non-empty by
// construction — the read boundary (feed.ts toContent) derives a deterministic
// fallback for legacy rows, so no generation is ever nameless. Symmetric with the
// `found` variant's `title`: both name the piece.
//
// [LAW:types-are-the-program] The generation arm carries three honest concerns: the heritable
// `genome`, how this instance was rendered + its provenance (`render`), and the async lifecycle
// (`status`). The phenotype (status.succeeded.output: Media) is rendered FROM the genome and is
// never part of it.
export type Content =
  | { kind: 'generation'; title: string; genome: Genome; render: GenerationRender; status: GenerationStatus }
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
// nowhere. [LAW:types-are-the-program] Both fields are non-empty by construction: the
// read boundary mints a Verdict only from a vote whose reasoning AND whose critic name
// are both meaningful, gating the two halves identically — a blank in EITHER is no
// verdict at all, never an empty hot-take or a bylineless `— `.
//
// [LAW:types-are-the-program] `disposition` is the representative vote's VoteValue
// (+1 → blessed, -1 → buried) wearing a name the card can dress: it carries the same
// two-valued duality the card already renders on VOTES (votive bless / profane bury),
// so a BURIAL verdict can no longer render in a BLESSING's gilt saint-robes. It is the
// vote's sign projected at read time, authoritative on the vote row, stored nowhere.
export type VerdictDisposition = "blessed" | "buried"
export type Verdict = {
  text: string
  critic: string
  disposition: VerdictDisposition
}

// [LAW:types-are-the-program] The seven lenses of The Daily Rite — the axes of
// greatness the city crowns by (design-docs/the-daily-rite.md). A closed union:
// the lens IS the discriminator from which the eternal mark, the presiding
// citizen, and the liturgical day all derive. There is no second `is_crowned`
// boolean and no stored mark — a crowned post carries exactly one lens, and
// everything visible about its crown is a pure function of that lens plus the day.
export type RiteLens =
  | 'saint'
  | 'villain'
  | 'heretic'
  | 'relic'
  | 'martyr'
  | 'miracle'
  | 'confession'

// [LAW:one-source-of-truth] The eternal mark's TONE — a pure function of the lens
// (markFor in app/lib/rite.ts), never stored. Gold for the sainted, magenta for
// the monstrous, bronze for the resurrected, split for the divisive, bone for the
// flawless. The gallery reads this tone to dress the card; it never re-derives
// lens→tone on its own, so the two can never disagree. Coarser than the lens (two
// lenses can share a tone) — the lens is the fine identity, the mark is its colour.
export type CrownMark = 'gold' | 'magenta' | 'bronze' | 'split' | 'bone'

// [LAW:one-source-of-truth] The read-time projection of a single crown record (the
// crowns table). Every field is derived: `lens` is stored, `mark` is markFor(lens),
// `riteDay` is the day the crown settled, `presiding` resolves the recorded
// presiding citizen's agentId into its public CitizenRef. The Proprietor's decree
// (an Utterance) is persisted on the record but NOT carried here — the feed needs
// only the mark; the Calendar surfaces the decree. A post with no crown has no
// Crowning at all (absence is the discriminator, not an `isCrowned` flag).
// [LAW:types-are-the-program] Crowns are forever, so `presiding` is the citizen who
// presided AT crowning time (read from the record), never re-derived from today's
// lens→citizen binding — a binding change must not rewrite history.
export type Crowning = {
  lens: RiteLens
  mark: CrownMark
  riteDay: string
  presiding: CitizenRef
}

export type RenderablePost = {
  post: Post
  score: number
  myVote: VoteValue | null
  commentCount: number
  viewerIsModifier: boolean
  // [LAW:dataflow-not-control-flow] The critics who SPOKE on this slop — each a first-class verdict
  // utterance (slopspot-voice-w2v.1), newest-first, capped at the co-presence cap. The COUNT is the
  // data the card renders by: 0 → no critic line, 1 → a single verdict, ≥2 → co-present side by side
  // (the feud's visual germ — the Gremlin's burial beside Vivian's blessing of the same slop). Never an
  // `isReviewed` flag; the array's length is the discriminator. Read from the utterances store
  // (verdictsForPosts), not re-derived from votes.reasoning. [LAW:one-source-of-truth]
  verdicts: readonly Verdict[]
  // [LAW:dataflow-not-control-flow] The back-and-forth — the citizens' replies to each other's opposing
  // verdicts on this slop (slopspot-voice-w2v.2, the Feud Engine), newest-first, capped at the
  // co-presence cap. Same Verdict shape as `verdicts` (a bylined line + disposition robe), a SECOND
  // reader of one type [LAW:one-type-per-behavior] — the reply renders identically to a verdict, it
  // merely answers one. The COUNT is the discriminator: 0 → no exchange (the common case), ≥1 → the
  // thread of answers beneath the opening positions. Derived from the utterances store (repliesForPosts,
  // occasion='reply'), never a stored feud status. [LAW:one-source-of-truth]
  exchange: readonly Verdict[]
  // [LAW:dataflow-not-control-flow] The eternal mark is optional BY DATA: an
  // uncrowned post simply has no Crowning, and the card renders the mark by its
  // presence — never an `isCrowned` flag the card must consult. Derived at read
  // time from the crowns table alone (feed.ts crowningsForPosts), the same shape
  // score=SUM(votes) takes — no stored mark to drift. [LAW:one-source-of-truth]
  crowning?: Crowning
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

// [LAW:types-are-the-program] A node in a post's family tree — a genome's PHENOTYPE,
// addressable by its post id, with the thumbnail to show and its kin in ONE direction.
// The relationship (ancestor vs offspring) is the node's POSITION in the Genealogy, never
// a field: `kin` is the parents inside `ancestors` and the children inside `offspring`, so
// "this node is an ancestor" cannot contradict an "is-ancestor" boolean — there is none.
// A Genome carries no Media (the genome/phenotype split — you cannot inherit a body), so
// the thumbnail is read from the node's render, NOT the genome; `null` is the honest value
// for a node whose slop has no phenotype yet (pending/running/failed), distinct by data
// from "no displayable image" which the renderer decides. `kin` empty = a founder (going
// up) or a leaf (going down) — the arity is the discriminator, no separate flag.
export type GenealogyNode = {
  postId: PostId
  thumbnail: Media | null
  kin: readonly GenealogyNode[]
}

// [LAW:one-source-of-truth] A post's visual genealogy, all three relations, derived ENTIRELY
// from the lineage_edges DAG + each node's render — never a stored ancestry (the same shape
// score=SUM(votes) and the Crowning take). Three empty arrays = a founder with no kin at all;
// the renderer shows nothing (absence is the discriminator, not an `isLineage` flag).
// [LAW:one-type-per-behavior] The per-post slice of the grand Slop Genome view; the grand
// dynasty explorer folds the WHOLE DAG, this folds the subgraph reachable from one post.
// `siblings` are the same-parent PEERS — a FLAT list (a peer is not nested: its own kin
// belong to ITS genealogy, not this post's), so each carries empty `kin`, the leaf idiom.
// A node sharing AT LEAST ONE parent is a sibling (half-siblings included); founders, having
// no parent, have no siblings — the parent edge is the relation, never a separate flag.
export type Genealogy = {
  ancestors: readonly GenealogyNode[]
  offspring: readonly GenealogyNode[]
  siblings: readonly GenealogyNode[]
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
