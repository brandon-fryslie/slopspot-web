// [LAW:single-enforcer] The read side of D1 for posts. The inverse of
// createPost (app/db/posts.ts): createPost switches on the status it writes and
// sets that arm's columns; this module switches on the status it reads and
// pulls that arm's columns. Same discriminators, opposite direction.
//
// Three readers live here because they share the same row→Post mapping
// (toPost/toContent/toStatus): getFeedPage for the paginated list (cursor keyset + score,
// commentCount, myVote aggregates), getFeedItemById for the permalink page (same aggregates,
// narrowed to one post by id), and getPostById for the fork form's parent-recipe fetch (no
// aggregates — the form does not render score/comments). Splitting them into separate files would
// duplicate the mapping or force an export-just-for-share — instead they share the helpers in-module.
//
// [LAW:types-are-the-program] FeedItem is the smooth seam between storage and rendering
// (app/lib/domain.ts). This module's whole job is to absorb the impedance between the storage shape
// (D1 columns are independently nullable; score is the materialized posts.score column) and the
// domain shape (Content/GenerationStatus are closed discriminated unions). Everything below is the
// residue of that one map.

import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { db } from '~/db/client'
import {
  comments,
  found,
  generations,
  lineageEdges,
  personas,
  posts,
  uploads,
  votes,
  type DbFound,
  type DbGeneration,
  type DbPost,
  type DbUpload,
} from '~/db/schema'
import {
  GenomeId,
  PostId,
  ProviderId,
  type Actor,
  type CitizenRef,
  type Content,
  type FeedItem,
  type GenerationStatus,
  type HumanModifier,
  type Lineage,
  type Media,
  type Origin,
  type PersonaActor,
  type Post,
  type RenderablePost,
  type TraitVector,
  type VoteValue,
} from '~/lib/domain'
import { assertNever } from '~/lib/assert-never'
import { authorLabel } from '~/lib/author-label'
import { crowningsForPosts } from '~/db/crowns'
import { repliesForPosts, verdictsForPosts } from '~/db/utterances'
import { emit } from '~/observability/metrics'
import {
  ASPECT_RATIOS,
  fallbackTitle,
  recipeSubjectSchema,
  STYLE_FAMILIES,
  type AspectRatio,
  type RecipeSubject,
  type StyleFamily,
} from '~/lib/variety'
import {
  applySortMode,
  cursorFilter,
  cursorFromRow,
  defaultSortMode,
  keysetOrderBy,
  windowFilter,
  type SortMode,
} from '~/lib/sort-mode'
import { decodeCursor, encodeCursor, type CursorPayload } from '~/lib/feed-cursor'
import { seedFloat } from '~/lib/hash'

// [LAW:dataflow-not-control-flow] How many posts a single feed read hydrates+renders. This is the
// dominant multiplier on the hot-path CPU: every per-post cost (row hydration, genome assembly,
// and the home page's React card render) is paid ×N, so N is the largest single CPU lever. The
// 2026-06-04 outage hit the Worker per-request CPU ceiling on this path; cutting N cuts that term
// near-proportionally. Set deliberately LOW (12) for the emergency restore — N is a VALUE on a
// fixed read path, not a mode. E1 (getFeedPage) makes this a PAGE size, not a truncation: depth is
// preserved across cursor pages, so the low value bounds per-request CPU without capping the feed.
// Raising it is a deliberate follow-up once per-page load is verified — it stays 12 for now.
// [LAW:one-source-of-truth] one default page-size; getFeedPage's `limit` defaults to it.
export const FEED_PAGE_SIZE = 12

// [LAW:one-source-of-truth] D1 IS a trust boundary (raw SQL / migrations / manual edits can write
// a bad enum), so the read DEFENDS — but it proves the SAME theorem the Zod enum parse did ("this
// value is one of the closed set") with a CHEAP proof, not an expensive one. A Set membership test
// is O(1) with no schema traversal and no error-object construction on the happy path, versus Zod's
// heavyweight per-read parse. Re-validating write-validated data on every read of every post is the
// recompute E1 forbids; the cheap proof keeps the boundary defense while removing the CPU. An
// out-of-set value still fails loud, identically to the Zod parse it replaces. [LAW:no-silent-fallbacks]
const STYLE_FAMILY_SET: ReadonlySet<string> = new Set(STYLE_FAMILIES)
const ASPECT_RATIO_SET: ReadonlySet<string> = new Set(ASPECT_RATIOS)
function memberOrThrow<T extends string>(
  value: string,
  set: ReadonlySet<string>,
  what: string,
  postId: string,
): T {
  if (!set.has(value)) {
    throw new Error(`feed: ${what} '${value}' not in its closed set for post ${postId}`)
  }
  return value as T
}

// One flat join row. The sibling tables are nullable because the DB does not
// enforce cross-table cardinality (that is createPost's transactional invariant);
// contentKind is the discriminator that says which sibling is the real one.
type FeedRow = {
  post: DbPost
  generation: DbGeneration | null
  upload: DbUpload | null
  found: DbFound | null
}

// [LAW:types-are-the-program] The storage→domain trust boundary. Columns carry the
// weaker storage type (T | null); the domain type is stronger (T). A null where the
// domain forbids one means storage violated an invariant — the generations_status_shape
// CHECK, or createPost's sibling-row cardinality. Fail loud here rather than launder it
// with `!`, which would let null silently corrupt a domain object downstream.
// [LAW:no-silent-fallbacks] explicit throw, not a skipped row.
function required<T>(value: T | null, what: string): T {
  if (value === null) {
    throw new Error(`feed: expected ${what} to be present in storage`)
  }
  return value
}

// The dual of `required`: the sibling table NOT named by contentKind must be empty.
// Together they assert exactly-one-sibling — a row that maps to two Content arms is
// ambiguous and must fail loud, not silently pick one. [LAW:no-silent-fallbacks]
function absent(value: unknown, what: string): void {
  if (value !== null) {
    throw new Error(`feed: unexpected ${what} present in storage`)
  }
}

// [LAW:single-enforcer] Sibling-row check for the contentKind discriminator —
// the SAME class of violation that produced the slopspot-prod-data-so2 outage
// (43/43 posts orphan, homepage 500). The fail-loud is `required`'s job; this
// wrapper adds the metric emission so the puller (homelab) can alert on a
// non-zero orphan rate long before users notice. The metric fires BEFORE the
// throw so even an immediately-handled re-throw still leaves a counter
// breadcrumb. [LAW:dataflow-not-control-flow] same code path every call; the
// emit is unconditional inside the null arm, never gated by an environment
// flag.
function requiredSibling<T>(
  value: T | null,
  contentKind: 'generation' | 'found' | 'upload',
  postId: string,
): T {
  if (value === null) {
    emit('slopspot.write.orphan_detected', { content_kind: contentKind }, 1)
    throw new Error(
      `feed: expected ${contentKind} sibling row for post ${postId} but storage has none`,
    )
  }
  return value
}

// JSON columns hold exactly what createPost serialized — our own shapes, not foreign
// input — so this is a typed deserialize, not a defensive re-parse. A malformed column
// is the same class of storage violation as `required`/`absent` guard, so it fails loud
// the same way: localize responsibility to the column/post rather than surfacing a
// context-free SyntaxError. [LAW:no-silent-fallbacks]
function parseJson<T>(json: string, what: string): T {
  try {
    return JSON.parse(json)
  } catch (err) {
    throw new Error(`feed: malformed JSON in ${what}`, { cause: err })
  }
}

// [LAW:types-are-the-program] Closed union → exhaustive switch, mirroring PostCard.
// Unlike PostCard (which consumes an already-constructed domain object), this runs at
// the storage boundary on a raw column, so the default arm asserts-never: it keeps the
// compile-time exhaustiveness check AND fails loud at runtime on a status the CHECK
// should never have admitted.
function toStatus(g: DbGeneration): GenerationStatus {
  switch (g.status) {
    case 'pending':
      return { kind: 'pending', queuedAt: required(g.queuedAt, 'pending.queuedAt') }
    case 'running':
      return { kind: 'running', startedAt: required(g.startedAt, 'running.startedAt') }
    case 'succeeded':
      return {
        kind: 'succeeded',
        output: parseJson<Media>(
          required(g.outputJson, 'succeeded.outputJson'),
          `output_json for post ${g.postId}`,
        ),
        completedAt: required(g.completedAt, 'succeeded.completedAt'),
      }
    case 'failed':
      return {
        kind: 'failed',
        reason: required(g.failedReason, 'failed.failedReason'),
        failedAt: required(g.failedAt, 'failed.failedAt'),
      }
    default:
      return assertNever(g.status, `status for post ${g.postId}`)
  }
}

// [LAW:types-are-the-program] Reconstruct the RecipeSubject discriminated union
// from the flattened storage columns. recipeSubjectSchema enforces that the
// slots JSON object's keys match exactly what the subject_template variant
// requires — so a row where (subject_template, slots_json) drifted (e.g.
// 'T05' with only `setting`, missing `timeOfDay`) fails loud here, the way
// a missing-column violation does in `required`. [LAW:no-silent-fallbacks]
function toRecipeSubject(
  subjectTemplate: string,
  slotsJson: string,
  postId: string,
): RecipeSubject {
  const slots = parseJson<unknown>(slotsJson, `slots_json for post ${postId}`)
  const parsed = recipeSubjectSchema.safeParse({ subjectTemplate, slots })
  if (!parsed.success) {
    throw new Error(
      `feed: malformed recipe subject for post ${postId}: ${parsed.error.message}`,
    )
  }
  return parsed.data
}

// [LAW:no-silent-fallbacks] Map the stored title to the domain's non-empty title.
// An empty stored title is the ONLY value that triggers the deterministic placard,
// and when it does the fallback is LOUD — a metric + a console.warn carrying the
// post id — never a silent blank. The expected cause is a pre-migration row, but the
// warn deliberately states only the observable fact (empty title) and the id, so an
// unexpected new-write bug is just as visible and traceable. New rows store a real
// name, so this derivation degrades to identity by data.
function titleOrFallback(stored: string, subject: RecipeSubject, postId: string): string {
  // Trim once: a whitespace-only title is as blank as '' on the card (→ fallback),
  // and a real title with stray surrounding whitespace renders clean. The invariant
  // is a *visible*, well-formed name, so the trimmed value is what the domain gets.
  const trimmed = stored.trim()
  if (trimmed.length > 0) return trimmed
  emit('slopspot.feed.title_fallback', { reason: 'empty_title' }, 1)
  const derived = fallbackTitle(subject)
  console.warn('feed: generation row has an empty title; derived placard from subject', {
    postId,
    subjectTemplate: subject.subjectTemplate,
    derived,
  })
  return derived
}

// [LAW:types-are-the-program] The lineage read-model: a child's parent genome ids → the closed
// Lineage union, by COUNT. The lineage_edges table is the source of truth; this is where its
// arity invariant {0,1,2} is enforced — a stored count outside that range is a corrupted DAG
// and fails loud at the boundary, never laundered. [LAW:no-silent-fallbacks]
function toLineage(parents: readonly GenomeId[], postId: string): Lineage {
  switch (parents.length) {
    case 0:
      return { kind: 'founder' }
    case 1:
      return { kind: 'single', parent: parents[0]! }
    case 2:
      return { kind: 'bred', parents: [parents[0]!, parents[1]!] }
    default:
      throw new Error(
        `lineage for post ${postId} has ${parents.length} parent edges; expected 0, 1, or 2`,
      )
  }
}

// [LAW:no-silent-fallbacks] A lineage edge belongs ONLY to a generation (a GenomeId IS a
// generation-post id). An edge whose child is an upload/found post is storage corruption, so a
// non-generation post carrying any parent must fail loud here — silently ignoring it would be
// the exact silent-fallback the rest of this read boundary (absent / requiredSibling /
// assertNever) refuses. The generation arm consumes `parents` via toLineage; the other arms
// assert there are none.
function noLineage(parents: readonly GenomeId[], kind: string, postId: string): void {
  if (parents.length > 0) {
    throw new Error(
      `${kind} post ${postId} has ${parents.length} lineage edge(s); only a generation (a genome) can have lineage`,
    )
  }
}

// [LAW:single-enforcer] The one read of the lineage DAG: fetch every child→parent edge for a
// set of child genome (post) ids in one query, grouped into a map. Edges are 0..2 per child, so
// they cannot ride the one-row-per-post feed join without multiplying rows — they are resolved
// separately and merged in JS, the same shape verdicts/crownings take. Empty input → empty map.
async function lineageParentsByChild(
  database: ReturnType<typeof db>,
  childIds: readonly string[],
): Promise<Map<string, GenomeId[]>> {
  const map = new Map<string, GenomeId[]>()
  if (childIds.length === 0) return map
  const rows = await database
    .select({ child: lineageEdges.childGenomeId, parent: lineageEdges.parentGenomeId })
    .from(lineageEdges)
    .where(inArray(lineageEdges.childGenomeId, [...childIds]))
    // [LAW:types-are-the-program] Deterministic parent order: a bred child's [a,b] is a TUPLE,
    // so its element order must be fixed across reads — DB return order is not guaranteed. Order
    // by parent id so toLineage's bred tuple (and L2's crossover fold reading it) is stable.
    .orderBy(asc(lineageEdges.parentGenomeId))
  for (const r of rows) {
    const list = map.get(r.child) ?? []
    list.push(GenomeId(r.parent))
    map.set(r.child, list)
  }
  return map
}

// [LAW:one-source-of-truth] Generation depth derives from lineage_edges ALONE (no stored gen column),
// the same single source the descendant count and the lineage badge read. [LAW:types-are-the-program]
// Over a two-parent breeding DAG depth is not single-valued; the FIXED definition (RenderablePost) is
// the LONGEST path to any founder. The ancestry sub-DAG is gathered by walking UP the parent edges from
// the visible posts only — reusing the tested `lineageParentsByChild` reader, bounded to their ancestry,
// NEVER the whole DAG (the genepool/cast folds load the full DAG; this is the hot feed read and must
// not). Depth is then a pure memoized longest-path fold over the gathered edges.
async function generationDepthByPost(
  database: ReturnType<typeof db>,
  postIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (postIds.length === 0) return out

  // Gather child→parents for the visible posts and every ancestor, one level UP per round, until the
  // frontier reaches founders (no parent edge → not re-queried). `visited` makes each node a one-time
  // lookup; the lineage DAG is acyclic (a parent is older), so the walk terminates by data.
  const parentsOf = new Map<string, GenomeId[]>()
  const visited = new Set<string>()
  let frontier = [...new Set(postIds)]
  while (frontier.length > 0) {
    for (const id of frontier) visited.add(id)
    const edges = await lineageParentsByChild(database, frontier)
    const next = new Set<string>()
    for (const [child, parents] of edges) {
      parentsOf.set(child, parents)
      for (const p of parents) if (!visited.has(p)) next.add(p)
    }
    frontier = [...next]
  }

  // [LAW:dataflow-not-control-flow] Longest path to a founder, memoized. A node with no parent edge is
  // a founder → 0; otherwise 1 + the deepest parent. A founder post yields 0 by data, never a branch.
  const memo = new Map<string, number>()
  const depthOf = (node: string): number => {
    const cached = memo.get(node)
    if (cached !== undefined) return cached
    const parents = parentsOf.get(node)
    const d = parents === undefined || parents.length === 0 ? 0 : 1 + Math.max(...parents.map(depthOf))
    memo.set(node, d)
    return d
  }
  for (const id of postIds) out.set(id, depthOf(id))
  return out
}

// [LAW:types-are-the-program] Closed union → exhaustive switch on the storage
// discriminator. Adding a new variant to posts.contentKind upstream forces
// this switch to grow before it compiles, matching the [LAW:single-enforcer]
// shape: one place reads each arm. The default branch's assertNever doubles
// as the runtime fail-loud for a contentKind no CHECK should have admitted.
// [LAW:no-silent-fallbacks]
// `parents` is this post's lineage edges (empty for non-generation posts and founders); only
// the generation arm consumes it, via toLineage.
function toContent(row: FeedRow, parents: readonly GenomeId[]): Content {
  switch (row.post.contentKind) {
    case 'upload': {
      absent(row.generation, `generations row for upload post ${row.post.id}`)
      absent(row.found, `found row for upload post ${row.post.id}`)
      noLineage(parents, 'upload', row.post.id)
      const u = requiredSibling(row.upload, 'upload', row.post.id)
      return {
        kind: 'upload',
        asset: parseJson<Media>(u.assetJson, `asset_json for post ${row.post.id}`),
      }
    }
    case 'found': {
      absent(row.generation, `generations row for found post ${row.post.id}`)
      absent(row.upload, `uploads row for found post ${row.post.id}`)
      noLineage(parents, 'found', row.post.id)
      const f = requiredSibling(row.found, 'found', row.post.id)
      const thumbnail =
        f.thumbnailJson === null
          ? undefined
          : parseJson<Media>(f.thumbnailJson, `thumbnail_json for post ${row.post.id}`)
      return {
        kind: 'found',
        url: f.url,
        title: f.title,
        ...(f.description !== null ? { description: f.description } : {}),
        ...(thumbnail !== undefined ? { thumbnail } : {}),
      }
    }
    case 'generation': {
      absent(row.upload, `uploads row for generation post ${row.post.id}`)
      absent(row.found, `found row for generation post ${row.post.id}`)
      const g = requiredSibling(row.generation, 'generation', row.post.id)
      // Variety enums at the trust boundary: a CHEAP membership proof (no per-read Zod parse) of
      // the same closed-set theorem — fails loud on a value outside the documented enums.
      const styleFamily = memberOrThrow<StyleFamily>(g.styleFamily, STYLE_FAMILY_SET, 'styleFamily', g.postId)
      const aspectRatio = memberOrThrow<AspectRatio>(g.aspectRatio, ASPECT_RATIO_SET, 'aspectRatio', g.postId)
      const subject = toRecipeSubject(g.subjectTemplate, g.slotsJson, g.postId)
      // traits_json: JSON.parse is the structural check (fails loud on malformed JSON). The [0,1]
      // bounds were validated at write (breed / migration 0027 default) — trusting them on the hot
      // read path removes a per-post Zod `.strict()` parse, the recompute E1 forbids. [LAW:one-source-of-truth]
      const traits = parseJson<TraitVector>(g.traitsJson, `traits_json for post ${g.postId}`)
      return {
        kind: 'generation',
        // [LAW:no-silent-fallbacks] An empty stored title triggers the deterministic
        // placard (the expected cause is a pre-migration row; any other empty write
        // surfaces here too). The domain never sees an empty title, and the unnamed
        // count is a LOUD metric + a post-id'd warn, not a silent blank placard.
        title: titleOrFallback(g.title, subject, g.postId),
        // [LAW:types-are-the-program] The heritable genome, reassembled from columns + the
        // lineage edges. genome.id IS the post id (the 1:1 in L1). lineage is the read-model
        // from edge COUNT (toLineage), arity asserted fail-loud.
        genome: {
          id: GenomeId(g.postId),
          genes: {
            species: styleFamily,
            form: subject,
            frame: aspectRatio,
            medium: ProviderId(g.providerId),
          },
          utterance: g.utterance,
          traits,
          lineage: toLineage(parents, g.postId),
        },
        // How this phenotype was rendered + provenance — not heritable.
        render: {
          providerVersion: g.providerVersion,
          params: parseJson<unknown>(g.paramsJson, `params_json for post ${g.postId}`),
          // The wish is genuinely optional (only Well-born generations have one),
          // so a NULL column is a legal absence, not a violated invariant — map it
          // to undefined rather than failing loud. [LAW:no-defensive-null-guards]
          ...(g.wish !== null ? { wish: g.wish } : {}),
        },
        status: toStatus(g),
      }
    }
    default:
      return assertNever(row.post.contentKind, `contentKind for post ${row.post.id}`)
  }
}

// [LAW:types-are-the-program] Storage→domain anti-corruption for origin_json. Two
// shapes coexist on disk by design: the current discriminated Origin
// ({ kind, author | finder | uploader }) and the pre-attribution legacy shape
// ({ actor }). Content.kind is the AUTHORITATIVE discriminator — the arm is chosen by
// it, never by a `kind` the JSON might disagree with, so the two can never drift apart
// at read. [LAW:one-source-of-truth]
//
// No Zod here (matching this module's parseJson cast — the shape is trusted at this
// boundary the way params_json is). The one invariant that MUST hold — a generation is
// AUTHORED by a persona — is checked and fails loud, exactly like the sibling-row and
// vote-value checks elsewhere in this reader. [LAW:no-silent-fallbacks]
function storedPrincipal(raw: unknown): Actor {
  const r = raw as { author?: Actor; finder?: Actor; uploader?: Actor; actor?: Actor }
  const a = r.author ?? r.finder ?? r.uploader ?? r.actor
  if (a === undefined) {
    throw new Error('origin_json carries no author/finder/uploader/actor')
  }
  return a
}

function storedHuman(raw: unknown): HumanModifier | undefined {
  return (raw as { human?: HumanModifier }).human
}

function storedCrossedFrom(raw: unknown): PersonaActor | undefined {
  return (raw as { crossedFrom?: PersonaActor }).crossedFrom
}

function toOrigin(contentKind: Content['kind'], raw: unknown, postId: string): Origin {
  const actor = storedPrincipal(raw)
  switch (contentKind) {
    case 'generation': {
      if (actor.kind !== 'agent') {
        // A generation is AUTHORED — its author is a persona, always. A non-agent here
        // is a storage-integrity violation (a human in the author slot); fail loud
        // rather than launder it into a shape the domain forbids.
        throw new Error(
          `origin_json for generation post ${postId} has a non-persona author (${actor.kind})`,
        )
      }
      const human = storedHuman(raw)
      const crossedFrom = storedCrossedFrom(raw)
      return {
        kind: 'authored',
        author: actor,
        ...(crossedFrom !== undefined ? { crossedFrom } : {}),
        ...(human !== undefined ? { human } : {}),
      }
    }
    case 'found':
      return { kind: 'found', finder: actor }
    case 'upload':
      return { kind: 'uploaded', uploader: actor }
    default:
      return assertNever(contentKind, `contentKind for origin of post ${postId}`)
  }
}

// [LAW:one-source-of-truth] [RECONCILE A] A persona's public identity (handle +
// displayName) is authoritative in the personas table. Feed readers resolve the
// agent Actor's reference (agentId) into a CitizenRef here rather than storing a
// redundant copy in origin_json. One batch query per feed load regardless of how
// many posts have agent origins. handle and displayName come from the same row,
// so the resolution is atomic — never a half-populated CitizenRef.
async function fetchCitizenRefs(
  database: ReturnType<typeof db>,
  agentIds: readonly string[],
): Promise<Map<string, CitizenRef>> {
  if (agentIds.length === 0) return new Map()
  const rows = await database
    .select({
      agentId: personas.agentId,
      handle: personas.handle,
      displayName: personas.displayName,
    })
    .from(personas)
    .where(inArray(personas.agentId, agentIds))
  // [LAW:types-are-the-program] A CitizenRef carries the citizen's NAME always and
  // its handle (null until minted). Every resolved persona row produces one — the
  // name is what attribution shows, the handle is what lights the /cast link.
  // [LAW:one-source-of-truth] The agentId-label fallback is for a genuinely
  // persona-less actor (no row here), never for an un-minted-but-named citizen.
  const refs = new Map<string, CitizenRef>()
  for (const r of rows) {
    refs.set(r.agentId, { handle: r.handle, displayName: r.displayName })
  }
  return refs
}

// [LAW:one-source-of-truth] Resolve an agent's persona reference (agentId) into its
// CitizenRef. Construct explicitly rather than spreading parsed JSON so the
// storage→domain boundary emits exactly the domain shape. A persona-less agent (no
// row) keeps just its agentId — the renderer's documented fallback. The narrowed
// return preserves PersonaActor for the author slot, which is agent-only by type.
function enrichPersona(a: PersonaActor, refs: Map<string, CitizenRef>): PersonaActor {
  const persona = refs.get(a.agentId)
  return persona !== undefined
    ? { kind: 'agent', agentId: a.agentId, persona }
    : { kind: 'agent', agentId: a.agentId }
}

function enrichActor(actor: Actor, refs: Map<string, CitizenRef>): Actor {
  return actor.kind === 'agent' ? enrichPersona(actor, refs) : actor
}

// [LAW:one-type-per-behavior] One enricher per origin arm: the author (a persona,
// always), the finder (any actor — a persona-finder gets the same face the author
// does), the uploader. The human modifier's `by` is a HumanRef (never a persona), so
// it carries no agentId to resolve. `crossedFrom` is also a PersonaActor and is
// enriched the same way as `author` when present.
function enrichOrigin(origin: Origin, refs: Map<string, CitizenRef>): Origin {
  switch (origin.kind) {
    case 'authored':
      return {
        kind: 'authored',
        author: enrichPersona(origin.author, refs),
        ...(origin.crossedFrom !== undefined ? { crossedFrom: enrichPersona(origin.crossedFrom, refs) } : {}),
        ...(origin.human !== undefined ? { human: origin.human } : {}),
      }
    case 'found':
      return { kind: 'found', finder: enrichActor(origin.finder, refs) }
    case 'uploaded':
      return { kind: 'uploaded', uploader: enrichActor(origin.uploader, refs) }
  }
}

function enrichPost(post: Post, refs: Map<string, CitizenRef>): Post {
  return { ...post, origin: enrichOrigin(post.origin, refs) }
}

// [LAW:single-enforcer] One pass collecting every agentId that needs a CitizenRef: the
// author of an authored slop (plus crossedFrom for hybrids), and a persona finder/
// uploader. Human modifiers reference no persona, so they contribute nothing.
function collectAgentIds(posts: readonly Post[]): string[] {
  const ids = new Set<string>()
  for (const p of posts) {
    const o = p.origin
    if (o.kind === 'authored') {
      ids.add(o.author.agentId)
      if (o.crossedFrom !== undefined) ids.add(o.crossedFrom.agentId)
    } else if (o.kind === 'found' && o.finder.kind === 'agent') ids.add(o.finder.agentId)
    else if (o.kind === 'uploaded' && o.uploader.kind === 'agent') ids.add(o.uploader.agentId)
  }
  return [...ids]
}

function toPost(row: FeedRow, parents: readonly GenomeId[]): Post {
  return {
    id: PostId(row.post.id),
    createdAt: row.post.createdAt,
    origin: toOrigin(
      row.post.contentKind,
      parseJson<unknown>(row.post.originJson, `origin_json for post ${row.post.id}`),
      row.post.id,
    ),
    content: toContent(row, parents),
  }
}

// [LAW:types-are-the-program] The schema's votes_value_shape CHECK guarantees a
// stored value is exactly -1 or 1; SQL returns it as `number`. This is the
// boundary translation back to VoteValue. A row that came back as something
// other than -1/1 means the CHECK was bypassed — fail loud, do not coerce.
function toMyVote(raw: number | null, postId: string): VoteValue | null {
  if (raw === null) return null
  if (raw === 1 || raw === -1) return raw
  throw new Error(
    `feed: vote value ${raw} for post ${postId} is outside the stored shape (-1 | 1)`,
  )
}

// [LAW:single-enforcer] The one place a viewer is compared to a slop's human
// modifier (origin.human.by — the wisher/breeder/patron). The full voter UUID is
// never written to origin_json (the write side redacts via authorLabel before
// storing — submit/found/fork all do), so the only honest comparison is
// label-to-label, and it MUST be server-side: the viewer's raw id never crosses to
// the client and a stranger never receives the modifier's identity.
// [LAW:dataflow-not-control-flow] The result is a VALUE that selects the card's
// second-person copy downstream, not a flag the card carries. False whenever there
// is no human modifier to be (no authored origin, or no human, or no viewer cookie).
function computeViewerIsModifier(origin: Origin, viewerId: string | undefined): boolean {
  if (origin.kind !== 'authored' || origin.human === undefined || viewerId === undefined) {
    return false
  }
  const by = origin.human.by
  switch (by.kind) {
    case 'anon':
      return by.label === authorLabel(viewerId)
    // No logged-in viewer identity exists yet (the viewer id is the anon cookie
    // UUID), so a user-wisher cannot be matched from this surface. Honest
    // third-person until a real auth viewer path exists. [LAW:no-silent-fallbacks]
    case 'user':
      return false
  }
}

// [LAW:single-enforcer] One place defines the FeedItem-shaped rowset's joins, aggregates, and
// column selection. Both readers (getFeedPage's hydration and getFeedItemById) build from this
// helper, so any aggregate change (new column, different COALESCE, a future per-post stat) lands in
// both views by construction — no drift risk.
//
// [LAW:one-source-of-truth][LAW:caches-are-derived] Score is the MATERIALIZED posts.score column —
// setVote is its single writer, recomputed from SUM(votes.value) on every vote, and the 0028
// backfill is its definition. Reading the column instead of re-summing the votes table on every
// feed render is what removed the dominant hot-path CPU cost (the 2026-06-04 outage); the votes
// table stays authoritative and the column is regenerable from it. commentCount stays a per-post
// COUNT bounded to the visible `ids` set. The LEFT JOIN + COALESCE keeps a comment-less post at
// numeric zero rather than NULL.
//
// [LAW:types-are-the-program] The `ids` parameter is the visible post set — the commentCount
// aggregate and the outer SELECT both narrow by it, so one value determines visibility everywhere.
//
// [LAW:dataflow-not-control-flow] The JOIN to the viewer's own vote runs every call; the sentinel
// when voterId is absent ('') matches no real UUID, so the LEFT JOIN yields null for every row.
// Empty `ids` → inArray(_, []) → WHERE false, so the helper degrades to "no rows" by data, never an
// early-return branch. The query is `.$dynamic()` so getFeedPage can append the display ORDER BY
// (applySortMode) while getFeedItemById uses it bare (a single post has no order).
function selectFeedRows(
  database: ReturnType<typeof db>,
  ids: readonly string[],
  voterId: string | undefined,
) {
  const commentCount = database
    .select({
      postId: comments.postId,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(comments)
    .where(inArray(comments.postId, ids))
    .groupBy(comments.postId)
    .as('comment_count')

  const cCount = sql<number>`coalesce(${commentCount.count}, 0)`

  // [LAW:one-source-of-truth] The "most-bred" descendant count, derived from the lineage DAG (the edge
  // table) with the SAME correlated subquery the Cast page's most-bred uses (app/db/citizens.ts) — a
  // child is any genome with an edge pointing here; both single and bred children count one edge per
  // parent. One source (lineage_edges), one derivation, no stored childCount column to drift.
  const descendantCount = sql<number>`(select count(*) from lineage_edges le where le.parent_genome_id = ${posts.id})`

  const myVote = alias(votes, 'my_vote')
  const myVoterId = voterId ?? ''

  return database
    .select({
      post: posts,
      generation: generations,
      upload: uploads,
      found,
      score: posts.score,
      myVote: myVote.value,
      commentCount: cCount,
      descendantCount,
    })
    .from(posts)
    .leftJoin(generations, eq(generations.postId, posts.id))
    .leftJoin(uploads, eq(uploads.postId, posts.id))
    .leftJoin(found, eq(found.postId, posts.id))
    .leftJoin(commentCount, eq(commentCount.postId, posts.id))
    .leftJoin(
      myVote,
      and(eq(myVote.postId, posts.id), eq(myVote.voterId, myVoterId)),
    )
    .where(inArray(posts.id, ids))
    .$dynamic()
}

// [LAW:single-enforcer] One row → one RenderablePost. Both readers funnel
// through this so the per-row construction of the four-field renderable
// shape lives in exactly one place. The feed reader spreads its output and
// adds `rank` (the only field unique to list-position views); the permalink
// reader returns it bare. The variability between "ranked" and "bare"
// renderable lives in the caller, not in a parameter to this helper —
// [LAW:dataflow-not-control-flow], the function does the same thing every
// time, the caller decides whether to augment.
type FeedRowWithAggregates = {
  post: DbPost
  generation: DbGeneration | null
  upload: DbUpload | null
  found: DbFound | null
  score: number
  myVote: number | null
  commentCount: number
  descendantCount: number
}

function rowToRenderablePost(
  row: FeedRowWithAggregates,
  viewerId: string | undefined,
  parents: readonly GenomeId[],
  generationDepth: number,
): RenderablePost {
  const post = toPost(row, parents)
  return {
    post,
    score: row.score,
    myVote: toMyVote(row.myVote, row.post.id),
    commentCount: row.commentCount,
    // origin.human.by is not touched by enrichPost (persona resolution only reaches
    // author/finder/uploader), so this bit computed pre-enrich rides through unchanged.
    viewerIsModifier: computeViewerIsModifier(post.origin, viewerId),
    // The base renderable carries no critics; the caller fills `verdicts`/`exchange` from the batched
    // verdictsForPosts/repliesForPosts reads (one query each over the visible set, never per-row).
    verdicts: [],
    exchange: [],
    // [LAW:dataflow-not-control-flow] Both lineage scalars ride through as DATA: descendantCount from
    // the per-row subquery, generationDepth from the batched ancestry walk the caller passes in (like
    // `parents`). A founder is 0 / 0 by data — no isRoot branch here or in the card.
    generationDepth,
    descendantCount: row.descendantCount,
  }
}

// [LAW:single-enforcer] The ONE rows→RenderablePost[] hydration. The clean seam is selection
// vs hydration: the caller owns the SELECT (which ids, in what order, how many — getFeedPage's
// keyset page, getFeedItemById's single row, getFeedItemsByIds' batch), and this owns turning
// those rows into hydrated renderables — the two lineage reads, then the four batched enrichments
// (persona faces, verdicts, replies, crownings), then the assembly. A new enrichment (a badge, a
// future per-post stat) lands here ONCE and reaches every reader, instead of being added to three
// functions in lockstep. [LAW:dataflow-not-control-flow] order is preserved (renderables follow
// rows), so a caller that ordered its rows keeps that order; the batched reads are keyed by id, so
// they are order-independent. Every read is over the visible set (no N+1), run concurrently.
async function hydrateRenderablePosts(
  database: ReturnType<typeof db>,
  rows: readonly FeedRowWithAggregates[],
  voterId: string | undefined,
): Promise<RenderablePost[]> {
  const visibleIds = rows.map((row) => row.post.id)
  const [parentsByChild, depthByPost] = await Promise.all([
    lineageParentsByChild(database, visibleIds),
    generationDepthByPost(database, visibleIds),
  ])
  const renderables = rows.map((row) =>
    rowToRenderablePost(
      row,
      voterId,
      parentsByChild.get(row.post.id) ?? [],
      depthByPost.get(row.post.id) ?? 0,
    ),
  )
  const agentIds = collectAgentIds(renderables.map((r) => r.post))
  const postIds = renderables.map((r) => r.post.id)
  const [refs, verdictsByPost, repliesByPost, crownings] = await Promise.all([
    fetchCitizenRefs(database, agentIds),
    verdictsForPosts(database, postIds),
    repliesForPosts(database, postIds),
    crowningsForPosts(database, postIds),
  ])
  return renderables.map((r): RenderablePost => {
    // [LAW:dataflow-not-control-flow] The verdicts ARRAY (empty when none, ≥2 = co-present) and the
    // crowning's PRESENCE are the discriminators the card renders by — not an isReviewed/isCrowned
    // flag. The crowning field is genuinely ABSENT (not undefined-valued) when no crown reigns, which
    // exactOptionalPropertyTypes demands; the conditional spread carries that absence faithfully.
    const crowning = crownings.get(r.post.id)
    return {
      ...r,
      post: enrichPost(r.post, refs),
      verdicts: verdictsByPost.get(r.post.id) ?? [],
      exchange: repliesByPost.get(r.post.id) ?? [],
      ...(crowning !== undefined ? { crowning } : {}),
    }
  })
}

// [LAW:no-mode-explosion] One page-size knob, capped. The default page is FEED_PAGE_SIZE; a caller
// may ask for up to MAX_FEED_PAGE (the homelab voter pulls a wider page). A missing/non-finite limit
// folds to the default; an out-of-range one clamps — never an error, the value decides the page.
export const MAX_FEED_PAGE = 50
function clampPageSize(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return FEED_PAGE_SIZE
  return Math.max(1, Math.min(MAX_FEED_PAGE, Math.floor(limit)))
}

// [LAW:single-enforcer] The cursor→active-cursor gate, in ONE place. The client cursor is a TRUST
// BOUNDARY: decodeCursor SHAPE-validates it once per request (Zod), and a cursor naming a different
// sort than the request is meaningless against this ORDER BY. Both degrade to page 1 (a null active
// cursor) and emit a metric so a client bug is visible — never a throw, never a half-valid object.
// A genuinely absent cursor (page 1) is silent: it is not a rejection. [LAW:dataflow-not-control-flow]
// the result is a real value the keyset query consumes (predicate ANDed in, or not), not a branch
// that changes which work runs.
function resolveCursor(sort: SortMode, raw: string | null): CursorPayload | null {
  if (raw === null) return null
  const decoded = decodeCursor(raw)
  if (decoded === null) {
    emit('slopspot.feed.cursor_rejected', { reason: 'garbage' }, 1)
    return null
  }
  if (decoded.m !== sort.mode) {
    emit('slopspot.feed.cursor_rejected', { reason: 'mode_mismatch' }, 1)
    return null
  }
  return decoded
}

// [LAW:types-are-the-program] One page of the feed: the rendered items plus the opaque cursor for
// the NEXT page. `nextCursor === null` is the honest end-of-feed signal — set exactly when the page
// came back short (fewer than `limit` candidates), never a guess.
export type FeedPage = { items: FeedItem[]; nextCursor: string | null }

// [LAW:single-enforcer] The read-side feed reader — the homepage list (/), the JSON feed (/api/feed),
// and the breeding-room mate pool (/breed/:id) all funnel through here. The mirror of createPost's
// discriminator-write, in a two-phase keyset shape:
//
//   Phase 1 — SELECT the page's ids by KEYSET. `keysetOrderBy` is the index-seekable selection axis
//   and `cursorFilter` is its lexicographic "strictly after" of the previous page's last row, so the
//   query SEEKS into the index at the cursor and reads `limit` rows forward — O(limit), independent of
//   scroll depth (no OFFSET, no scan-and-discard). The score it keysets on is the MATERIALIZED
//   posts.score column, so there is NO per-read SUM over the votes table (the 2026-06-04 outage cost).
//
//   Phase 2 — HYDRATE those ids into FeedItems (selectFeedRows) ordered by `applySortMode` (the DISPLAY
//   order). For top/new the display axis IS the keyset axis, so order is preserved; for hot the display
//   axis is the time-decayed hotness, re-sorting the already-selected page (the §4.2 within-slab
//   re-sort, a bounded temp sort over ≤limit rows). Phase 1 establishes WHICH rows and the nextCursor
//   boundary; phase 2 establishes the order they render in.
//
// [LAW:dataflow-not-control-flow] windowFilter / cursorFilter return predicates ANDed into the WHERE
// unconditionally (undefined = no-op); an empty candidate set flows to `[]` through inArray([])→false,
// no early-return branch. The viewer's backing lens is the flagged follow-up roll-call-47p.7 (not in
// this core): the keyset is the bare stored score for every viewer.
export async function getFeedPage(
  env: Env,
  opts: { sort?: SortMode; voterId?: string; limit?: number; cursor?: string | null },
): Promise<FeedPage> {
  const database = db(env)
  const sort = opts.sort ?? defaultSortMode
  const voterId = opts.voterId
  const limit = clampPageSize(opts.limit)
  const activeCursor = resolveCursor(sort, opts.cursor ?? null)

  // Phase 1: the O(limit) keyset seek. ctx.score is the BARE posts.score column so the
  // (score, created_at, id) index serves the top keyset and (created_at, id) serves new/hot.
  const keysetCtx = { score: posts.score, createdAt: posts.createdAt, id: posts.id }
  const keysetRows = await database
    .select({ id: posts.id, score: posts.score, createdAt: posts.createdAt })
    .from(posts)
    .where(
      and(
        windowFilter(sort, posts.createdAt, Date.now()),
        activeCursor ? cursorFilter(activeCursor, keysetCtx) : undefined,
      ),
    )
    .orderBy(...keysetOrderBy(sort, keysetCtx))
    .limit(limit)

  // [LAW:no-silent-fallbacks] nextCursor is null EXACTLY when the page didn't fill — the honest
  // "no more rows," never a guess. Otherwise it is the keyset boundary: the LAST row in keyset order
  // (lowest position reached), which the next page reads strictly after. For hot this row carries the
  // MIN created_at of the page by construction of keysetOrderBy.
  const nextCursor =
    keysetRows.length < limit
      ? null
      : encodeCursor(cursorFromRow(sort, keysetRows[keysetRows.length - 1]!))

  const ids = keysetRows.map((r) => r.id)

  // Phase 2: hydrate the page in DISPLAY order. applySortMode over the ≤limit selected rows is the
  // keyset order for top/new (a no-op re-sort) and the hotness re-sort for hot.
  const rows = await selectFeedRows(database, ids, voterId).orderBy(
    ...applySortMode(sort, { score: posts.score, createdAt: posts.createdAt, id: posts.id }),
  )

  // [LAW:single-enforcer] Hydrate the page through the one rows→RenderablePost[] path; the page's
  // sole addition is `rank` (1..limit, page-relative) — the FeedItem IS a RenderablePost plus its
  // list position. [LAW:dataflow-not-control-flow] rank rides the display order the rows already
  // carry (applySortMode above); the focal/crowned-relic treatment is a page-1 concern the client owns.
  const renderables = await hydrateRenderablePosts(database, rows, voterId)
  const items = renderables.map((r, i): FeedItem => ({ ...r, rank: i + 1 }))

  return { items, nextCursor }
}

// [LAW:single-enforcer] Single-post lookup — the permalink route (/p/:id)
// funnels through here. Returns RenderablePost (not FeedItem) because rank
// is feed-list-position semantics, meaningless when there's no list.
// [LAW:one-type-per-behavior] — the return type itself records that this
// is a single-post view, not a list-of-one. Returns null on miss (the wire
// decides the 404 status; the reader does not throw on absence, only on
// shape violations).
//
// The shared selectFeedRows helper guarantees the same aggregates the feed
// uses — score, commentCount, myVote — so a future change to any aggregate
// applies to both views by construction.
//
// [LAW:dataflow-not-control-flow] `id` is PostId | null: an absent id (the home hero when
// no crown has settled) is a VALUE, not a reason to skip the call. A null id becomes an
// empty candidate set that flows through the same query — no rows match, the existing
// empty-result arm yields null. The caller stays uniform (always calls this); the null
// decides the outcome, never a caller-side guard around the await.
export async function getFeedItemById(
  env: Env,
  id: PostId | null,
  voterId?: string,
): Promise<RenderablePost | null> {
  const database = db(env)
  // [LAW:dataflow-not-control-flow] #109's null-id (home hero, no crown settled) is a VALUE — a null
  // becomes an empty candidate set; my selectFeedRows returns the dynamic query directly (it reads the
  // materialized posts.score, no voteScoreSubquery). Both preserved: the null→[] handling AND the
  // direct-return shape.
  const rows = await selectFeedRows(database, id === null ? [] : [id], voterId).limit(1)
  // [LAW:one-type-per-behavior] The permalink yields the same RenderablePost the feed does — same
  // verdicts, same eternal mark — because it hydrates through the same one path. A single row in,
  // its one renderable out; an empty selection (a null id or a miss) is the empty array → null.
  const [renderable] = await hydrateRenderablePosts(database, rows, voterId)
  return renderable ?? null
}

// [LAW:single-enforcer] The batch sibling of getFeedItemById — resolve MANY postIds to
// RenderablePosts in ONE pass (the museum halls resolve every crowned post's image at
// once, so the page is a few batched queries, never N+1). Same selectFeedRows hydration
// as the feed and the permalink, so a crowned post's image parses identically here — no
// second Media parser. Keyed by post.id so the caller zips by id; an id with no surviving
// post (a deleted slop a crown still references) simply drops out — a real absence in the
// map, never a thrown miss. The map carries no order; the caller (museum) renders in the
// crown list's order, so this reader stays order-free.
// [LAW:dataflow-not-control-flow] An empty id set degrades to an empty map by data
// (inArray([]) → no rows), never an early-return branch.
export async function getFeedItemsByIds(
  env: Env,
  ids: readonly PostId[],
  voterId?: string,
): Promise<Map<string, RenderablePost>> {
  const database = db(env)
  const rows = await selectFeedRows(database, ids, voterId)
  // [LAW:single-enforcer] Same one hydration path as the page and the permalink, so a crowned post's
  // image and mark parse identically here. Keyed by post.id so the caller zips by id; an id with no
  // surviving post is simply absent from the map — a real absence, never a thrown miss.
  const renderables = await hydrateRenderablePosts(database, rows, voterId)
  return new Map(renderables.map((r) => [r.post.id, r]))
}

// [LAW:no-mode-explosion] How many mates the breeding room shows at once — a deliberate WINDOW onto
// the seeded shuffle, distinct from FEED_PAGE_SIZE (the homepage hot-path CPU lever). The pool is
// the WHOLE breedable gene pool; this is just how much of one shuffle is on screen.
export const BREEDING_POOL_WINDOW = 24

// [LAW:decomposition] The breeding room's gene pool is its OWN concern, not "whatever sits on Hot
// page 1." Every succeeded image generation is breedable DNA — so this reader owns that candidate
// set directly: it filters to breedable rows at the SQL boundary (the count is then REAL, never a
// feed page minus the found/upload posts that happened to land on it), seeded-shuffles them, and
// windows the result. Reusing getFeedPage fused the room to Hot ranking + page size and left any
// genome off page 1 unbreedable — contradicting "slop has heritable DNA." This is the un-fusing.
//
// [LAW:one-source-of-truth] The shuffle order is the city's ONE hash (seedFloat) — a deterministic
// sort key per (seed, postId). Same seed → same order (reproducible, shareable); a fresh seed
// reshuffles to a different slice of the SAME pool, so the whole gene pool is reachable ACROSS
// seeds, not just one ranked page. The 'breed-pool' tag namespaces this stream so it stays
// uncorrelated with the chooser/persona/scheduler/breed streams sharing the hash.
//
// [LAW:single-enforcer] Phase 2 hydrates through getFeedItemsByIds — the one rows→RenderablePost
// path — so a mate's image, score, and verdicts parse identically to the feed; the id-keyed Map
// lets the caller restore the shuffled order it chose in phase 1.
//
// [LAW:no-silent-failure] Phase 1 has no LIMIT on purpose — the seed must be able to reach any
// genome in the pool, so the whole breedable id set is fetched (id-only, over the indexed
// generations join) and shuffled in memory. At today's pool size this is cheap; if the pool grows
// to many thousands this wants a stored random key or reservoir sampling (a genome-epic concern).
// That bound is documented here, not silently enforced by a hidden cap.
export async function getBreedablePool(
  env: Env,
  opts: { excludeId: PostId; seed: string; voterId?: string; window?: number },
): Promise<RenderablePost[]> {
  const database = db(env)
  const window = opts.window ?? BREEDING_POOL_WINDOW

  const candidates = await database
    .select({ id: posts.id })
    .from(posts)
    .innerJoin(generations, eq(generations.postId, posts.id))
    .where(
      and(
        eq(posts.contentKind, 'generation'),
        eq(generations.status, 'succeeded'),
        ne(posts.id, opts.excludeId),
      ),
    )

  // [LAW:dataflow-not-control-flow] An empty pool flows to [] through the same map/sort/slice — no
  // early-return branch. The sort key spreads each id deterministically under the seed.
  const windowIds = candidates
    .map((r) => ({ id: PostId(r.id), key: seedFloat(0, 'breed-pool', opts.seed, r.id) }))
    .sort((a, b) => a.key - b.key)
    .slice(0, window)
    .map((r) => r.id)

  const byId = await getFeedItemsByIds(env, windowIds, opts.voterId)
  // Restore the shuffled order from the id-keyed map; an id with no surviving post simply drops out.
  return windowIds.flatMap((id) => {
    const post = byId.get(id)
    return post === undefined ? [] : [post]
  })
}

// [LAW:single-enforcer] Single-post lookup — fork's parent-recipe fetch funnels
// through here. Returns null on miss (the wire decides the 404 status; the
// reader does not throw on absence, only on shape violations). Same toPost
// helpers as the feed reader, so a generation post's recipe parses identically whether
// it arrives via the feed or via this lookup — the wire shape (Content, Status,
// RecipeSubject) is one boundary translation, not two.
//
// [LAW:dataflow-not-control-flow] Same query shape as the feed hydration minus the
// aggregates: posts + LEFT JOIN generations + LEFT JOIN uploads. No per-post
// score/commentCount/myVote because fork's loader does not render those — it
// renders the recipe form.
export async function getPostById(env: Env, id: PostId): Promise<Post | null> {
  const database = db(env)

  const rows = await database
    .select({
      post: posts,
      generation: generations,
      upload: uploads,
      found,
    })
    .from(posts)
    .leftJoin(generations, eq(generations.postId, posts.id))
    .leftJoin(uploads, eq(uploads.postId, posts.id))
    .leftJoin(found, eq(found.postId, posts.id))
    .where(eq(posts.id, id))
    .limit(1)

  if (rows.length === 0) return null
  const parentsByChild = await lineageParentsByChild(database, [rows[0].post.id])
  return toPost(rows[0], parentsByChild.get(rows[0].post.id) ?? [])
}

// [LAW:single-enforcer] The one count of "how much slop the city has made" — the live
// gauge under the masthead ("Non-Stop Slop") and the footer's tally read the SAME number,
// so the two can never disagree. Every post is a slop (a generation, an upload, a found
// link), so this is the full corpus, not a windowed page — the relentless productivity,
// made visible. [LAW:one-source-of-truth] the footer no longer counts the rendered page
// (which lies — it is the feed window, not the city's output); both read this.
export async function countSlops(env: Env): Promise<number> {
  const rows = await db(env)
    .select({ count: sql<number>`count(*)` })
    .from(posts)
  return rows[0]?.count ?? 0
}
