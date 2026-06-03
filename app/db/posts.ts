// [LAW:single-enforcer] The one place a Post comes into existence. Every writer —
// the /api/generate route, the firehose cron, the bootstrap script, future
// submission UI — funnels through createPost. The provider call, R2 ingestion,
// and the generations status lifecycle live here exactly once, so they cannot
// drift per-callsite.

import { eq } from 'drizzle-orm'
import type { ZodError, ZodIssue } from 'zod'
import { db } from '~/db/client'
import { found, generations, lineageEdges, posts } from '~/db/schema'
import { emit } from '~/observability/metrics'
import { getProvider } from '~/providers'
import { ingestImage } from '~/storage/ingest'
import type {
  AuthoredOrigin,
  FoundOrigin,
  Genes,
  Lineage,
  Media,
  Post,
  PostId,
  ProviderId,
  TraitVector,
} from '~/lib/domain'
import { GenomeId, PostId as makePostId } from '~/lib/domain'

// [LAW:types-are-the-program] CreatePostInput is a discriminated union — the
// variant the caller wants to write IS the input shape, not a flag inside it.
// Adding 'found' here forces every call site to declare which Content arm it
// is producing, and the writer switches on that discriminator to do the right
// work. No "generation by default" implicit case; the type forbids ambiguity.
export type CreatePostInput =
  | {
      kind: 'generation'
      // [LAW:types-are-the-program] The heritable genome the caller composed, MINUS its id:
      // the post id is minted here (the single writer) and IS the genome id, so the caller
      // cannot supply it. genes.medium is the provider to look up; `params` is the provider-
      // native render config the caller derived from the genome (utterance + genes + seed).
      genes: Genes
      utterance: string
      traits: TraitVector
      // The lineage the caller knows: founder (firehose), single{parent} (fork), bred{[a,b]}
      // (L2). createPost writes the corresponding lineage_edges rows (0/1/2).
      lineage: Lineage
      params: unknown
      // [LAW:one-source-of-truth] The placard NAME for this piece. Composed by the
      // caller (the firehose's one Haiku call; the deterministic fallbackTitle for
      // fork / direct-API paths) and persisted here, the single writer. Required and
      // non-empty — createPost trusts its typed input rather than re-deriving a name.
      title: string
      // [LAW:one-source-of-truth] A generation is AUTHORED — its origin must carry a
      // persona author. Demanding AuthoredOrigin here pairs Content.kind with
      // Origin.kind at construction: a 'found' origin cannot reach a generation row.
      origin: AuthoredOrigin
      // The human wish, when this generation was born of a Well wish. Stored as
      // provenance; never forwarded to the provider (it is not part of params).
      // [LAW:one-source-of-truth]
      wish?: string
    }
  | {
      kind: 'found'
      url: string
      title: string
      description?: string
      // Optional thumbnail: caller passes the raw upstream URL plus dimensions
      // it already knows (scraped from source, or from the discovery agent's
      // metadata). The writer ingests the bytes into R2 and rewrites the url
      // to /media/<sha256>, keeping w/h/alt verbatim from the caller — the
      // exact mirror of the generation flow, where the provider returns
      // dimensions and createPost rehosts the bytes. [LAW:single-enforcer]
      // every hosted image still goes through ingestImage.
      thumbnail?: { url: string; w: number; h: number; alt?: string }
      // [LAW:one-source-of-truth] A found slop is SUBMITTED, not authored — its origin
      // credits a finder, never an author. FoundOrigin makes that the only shape a
      // found row can carry.
      origin: FoundOrigin
    }

// [LAW:types-are-the-program] The caller's params failing the provider schema is
// a distinct, named failure — not a bare ZodError. ZodError is also thrown deep
// inside a provider when it parses an *upstream* response (contract drift); if the
// boundary discriminated on ZodError it would misread that as a caller error. This
// type makes "the caller sent bad params" unambiguous, so everything else (provider
// failures included) is, by construction, not it.
export class InvalidParamsError extends Error {
  readonly issues: ZodIssue[]
  constructor(
    readonly providerId: ProviderId,
    error: ZodError,
  ) {
    super(`Invalid params for provider: ${providerId}`)
    this.name = 'InvalidParamsError'
    this.issues = error.issues
  }
}

// Best-effort diagnostic for the failed_reason column. `err.message` alone is
// low-signal for SDK errors that stash the actionable detail in extra fields
// (status text vs. an upstream body). Append a structural summary of own
// enumerable props — provider-agnostic, so the writer stays decoupled from any
// provider SDK's error type.
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const props = err as unknown as Record<string, unknown>
  const own = Object.keys(props)
  if (own.length === 0) return err.message
  const detail = Object.fromEntries(own.map((k) => [k, props[k]]))
  // describeError runs while building the failed-status update, so it must be
  // total: JSON.stringify is partial (throws on circular refs / BigInt), and a
  // throw here would abort the very write that makes the failure observable.
  // Degrade to the message + a visible marker rather than silently losing it.
  try {
    return `${err.message} ${JSON.stringify(detail)}`
  } catch {
    return `${err.message} [unserializable detail]`
  }
}

export async function createPost(
  input: CreatePostInput,
  ctx: { env: Env },
): Promise<Post> {
  // [LAW:dataflow-not-control-flow] The variant of CreatePostInput selects the
  // arm; each arm runs its own straight-line code. 'found' has no provider, no
  // async status lifecycle, optionally one ingest — fundamentally different
  // work than 'generation'. Splitting here keeps the generation pipeline
  // unchanged (a 'found' insert can never accidentally enter the provider
  // path) and keeps [LAW:single-enforcer] for post creation: both arms are
  // inside createPost.
  if (input.kind === 'found') return createFoundPost(input, ctx)
  return createGenerationPost(input, ctx)
}

// [LAW:dataflow-not-control-flow][LAW:types-are-the-program] The write-side fold from a Lineage
// to its lineage_edges rows: founder → 0, single → 1, bred → 2. The arity is carried by the
// union, so the row count is a property of the data, never a branch the caller manages. An
// empty list (founder) simply contributes no edge statement to the batch.
function lineageEdgeRows(
  childId: PostId,
  lineage: Lineage,
): { childGenomeId: string; parentGenomeId: string }[] {
  switch (lineage.kind) {
    case 'founder':
      return []
    case 'single':
      return [{ childGenomeId: childId, parentGenomeId: lineage.parent }]
    case 'bred':
      return lineage.parents.map((p) => ({ childGenomeId: childId, parentGenomeId: p }))
    default: {
      const _exhaustive: never = lineage
      return _exhaustive
    }
  }
}

async function createGenerationPost(
  input: Extract<CreatePostInput, { kind: 'generation' }>,
  ctx: { env: Env },
): Promise<Post> {
  const { env } = ctx
  const database = db(env)

  // [LAW:single-enforcer] Provider lookup + param validation cross the registry's
  // trust boundary here. Both throw before any row is written (unknown provider /
  // bad params are caller errors, not failed generations), so neither leaves a
  // dangling row. The provider is the genome's `medium` gene.
  const provider = getProvider(input.genes.medium)
  const validated = provider.paramsSchema.safeParse(input.params)
  if (!validated.success) {
    throw new InvalidParamsError(provider.id, validated.error)
  }
  const params = validated.data

  // [LAW:single-enforcer][LAW:no-silent-fallbacks] The placard is required and
  // non-empty — enforce it at the one write boundary so a blank can never be
  // persisted. Every legitimate caller already supplies a real name (the composer
  // trims and rejects empty; fallbackTitle is total). A blank here is a caller bug,
  // and persisting it would masquerade downstream as a pre-migration legacy row
  // (firing the empty_title fallback), so fail loud before any row is written rather
  // than launder the violation into the backlog metric.
  if (input.title.trim().length === 0) {
    throw new Error('createPost: generation title must be a non-empty placard, got blank')
  }

  const id = makePostId(crypto.randomUUID())
  const startedAt = new Date()

  // [LAW:types-are-the-program] Pre-insert as 'running' before calling the
  // provider, so a provider failure (or a worker crash mid-generation) leaves an
  // observable row rather than nothing. createPost is synchronous — it starts the
  // generation immediately — so 'running' is the true state from insert until the
  // provider resolves; it never persists 'pending' (a queued-not-started state no
  // synchronous caller occupies). D1 batch is not transactional: each statement
  // commits independently. The success check below is the cardinality enforcer —
  // if the generations row does not land, we detect and clean up before going
  // further so feed reads never see a post without its sibling.
  // [LAW:dataflow-not-control-flow] The lineage edges are a data-derived list (0/1/2 rows);
  // they ride in the same batch after the posts row so the child FK is satisfiable in order.
  const edgeRows = lineageEdgeRows(id, input.lineage)
  let postInsert: unknown
  let genInsert: unknown
  let edgeInserts: unknown[]
  try {
    const results = await database.batch([
      database.insert(posts).values({
        id,
        createdAt: startedAt,
        contentKind: 'generation',
        originJson: JSON.stringify(input.origin),
      }),
      database.insert(generations).values({
        postId: id,
        providerId: provider.id,
        providerVersion: provider.version,
        paramsJson: JSON.stringify(params),
        title: input.title,
        utterance: input.utterance,
        traitsJson: JSON.stringify(input.traits),
        styleFamily: input.genes.species,
        subjectTemplate: input.genes.form.subjectTemplate,
        slotsJson: JSON.stringify(input.genes.form.slots),
        aspectRatio: input.genes.frame,
        wish: input.wish ?? null,
        status: 'running',
        startedAt,
      }),
      ...edgeRows.map((r) => database.insert(lineageEdges).values(r)),
    ])
    postInsert = results[0]
    genInsert = results[1]
    edgeInserts = results.slice(2)
  } catch (err) {
    emit('slopspot.write.batch_outcome', { content_kind: 'generation', outcome: 'failed' }, 1)
    throw err
  }
  // [LAW:no-silent-fallbacks] drizzle's mapRunResult never checks D1Result.success,
  // so per-statement failures inside a batch silently resolve without throwing.
  // Cast to the raw D1Result shape and fail loud — the orphan-post incident (May 2026)
  // was caused by exactly this silent path.
  const postRaw = postInsert as unknown as { success: boolean; error?: string }
  if (!postRaw.success) {
    emit('slopspot.write.batch_outcome', { content_kind: 'generation', outcome: 'failed' }, 1)
    throw new Error(`posts INSERT failed: ${postRaw.error ?? 'unknown'}`)
  }
  // D1 batch is not transactional: the posts row may have committed even when the
  // generations INSERT reports success:false. Confirm posts succeeded before
  // deleting — if both failed, there is no orphan to clean up.
  const genRaw = genInsert as unknown as { success: boolean; error?: string }
  if (!genRaw.success) {
    const genError = `generations INSERT failed: ${genRaw.error ?? 'unknown'}`
    // [LAW:dataflow-not-control-flow] cleanupNote is data that varies by outcome;
    // emit and throw run unconditionally so cleanup failures cannot skip the metric.
    let cleanupNote = ''
    try {
      const cleanupResult = await database.delete(posts).where(eq(posts.id, id))
      const cleanupRaw = cleanupResult as unknown as { success: boolean; error?: string }
      if (!cleanupRaw.success) {
        cleanupNote = `; orphan cleanup also failed: ${cleanupRaw.error ?? 'unknown'}`
      }
    } catch (cleanupErr) {
      cleanupNote = `; orphan cleanup threw: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`
    }
    emit('slopspot.write.batch_outcome', { content_kind: 'generation', outcome: 'failed' }, 1)
    throw new Error(`${genError}${cleanupNote}`)
  }
  // [LAW:no-silent-fallbacks] A lineage edge that silently fails to land would make a single/
  // bred child read as a founder (0 edges) — a corrupted DAG, not a missing optional. Check
  // each edge the same way as the sibling rows; on failure delete the post (cascade clears the
  // generations row and any committed edges) so the read boundary never sees a half-lineage.
  for (const edgeInsert of edgeInserts) {
    const edgeRaw = edgeInsert as unknown as { success: boolean; error?: string }
    if (edgeRaw.success) continue
    const edgeError = `lineage_edges INSERT failed: ${edgeRaw.error ?? 'unknown'}`
    let cleanupNote = ''
    try {
      const cleanupResult = await database.delete(posts).where(eq(posts.id, id))
      const cleanupRaw = cleanupResult as unknown as { success: boolean; error?: string }
      if (!cleanupRaw.success) {
        cleanupNote = `; orphan cleanup also failed: ${cleanupRaw.error ?? 'unknown'}`
      }
    } catch (cleanupErr) {
      cleanupNote = `; orphan cleanup threw: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`
    }
    emit('slopspot.write.batch_outcome', { content_kind: 'generation', outcome: 'failed' }, 1)
    throw new Error(`${edgeError}${cleanupNote}`)
  }

  let output: Media
  let completedAt: Date
  const generateStartedMs = Date.now()
  try {
    const generated = await provider.generate(
      { params, aspectRatio: input.genes.frame },
      { env },
    )
    // [LAW:single-enforcer] Every external image flows through ingestImage so the
    // stored url is ours (R2), never the provider CDN. Every provider today
    // produces image media; a non-image return is an unsupported capability, so
    // fail loudly rather than persist an un-ingested upstream url.
    if (generated.kind !== 'image') {
      throw new Error(
        `createPost: provider ${provider.id} returned ${generated.kind} media; only image ingestion is supported`,
      )
    }
    const ingested = await ingestImage(generated.url, env)
    output = { ...generated, url: ingested.url }
    completedAt = new Date()
    emit(
      'slopspot.provider.generate_duration_ms',
      { provider_id: provider.id, outcome: 'success' },
      Date.now() - generateStartedMs,
    )
  } catch (err) {
    // [LAW:types-are-the-program] running → failed: clear the running arm's column
    // (started_at) and set the failed arm's, satisfying generations_status_shape.
    // The row persists for observability; rethrow so the caller owns the response
    // (route → 5xx, cron → log-and-continue).
    await database
      .update(generations)
      .set({
        status: 'failed',
        startedAt: null,
        failedAt: new Date(),
        failedReason: describeError(err),
      })
      .where(eq(generations.postId, id))
    emit(
      'slopspot.provider.generate_duration_ms',
      { provider_id: provider.id, outcome: 'failed' },
      Date.now() - generateStartedMs,
    )
    emit('slopspot.write.batch_outcome', { content_kind: 'generation', outcome: 'failed' }, 1)
    throw err
  }

  // [LAW:types-are-the-program] running → succeeded: clear started_at, set the
  // succeeded arm (completed_at + output_json). Wrapped so a D1 outage between
  // the provider's success and the row's transition is observable as
  // `batch_outcome=failed` instead of metric silence (the success path simply
  // not emitting). Without this wrapper the row is stuck in 'running' state
  // AND no metric records the catastrophic write — a phantom call in the
  // puller (`provider.generate_duration_ms` succeeded, no batch outcome).
  // [LAW:single-enforcer] this is the writer's job, not the cron handler's:
  // scheduled.ts's `firehose.fire = skipped-error` catches the propagated
  // exception, but per-write coverage belongs here next to the row state it
  // describes.
  try {
    await database
      .update(generations)
      .set({
        status: 'succeeded',
        startedAt: null,
        completedAt,
        outputJson: JSON.stringify(output),
      })
      .where(eq(generations.postId, id))
  } catch (err) {
    emit('slopspot.write.batch_outcome', { content_kind: 'generation', outcome: 'failed' }, 1)
    throw err
  }

  emit('slopspot.write.batch_outcome', { content_kind: 'generation', outcome: 'success' }, 1)
  emit(
    'slopspot.post.created',
    {
      content_kind: 'generation',
      provider_id: provider.id,
      style_family: input.genes.species,
    },
    1,
  )
  emit('slopspot.provider.cost_usd', { provider_id: provider.id }, provider.capabilities.costEstimateUsd)

  return {
    id,
    createdAt: startedAt,
    origin: input.origin,
    content: {
      kind: 'generation',
      title: input.title,
      // [LAW:types-are-the-program] The genome id IS the post id (the genome/phenotype 1:1 in
      // L1); a distinct brand over the same value. genes/utterance/traits/lineage are the
      // caller's heritable input, carried back whole.
      genome: {
        id: GenomeId(id),
        genes: input.genes,
        utterance: input.utterance,
        traits: input.traits,
        lineage: input.lineage,
      },
      render: {
        providerVersion: provider.version,
        params,
        ...(input.wish !== undefined ? { wish: input.wish } : {}),
      },
      status: { kind: 'succeeded', output, completedAt },
    },
  }
}

// [LAW:single-enforcer] One write path for 'found' posts. The route layer
// (slopspot-content-sources-svq.2) and discovery agents (slopspot-content-
// sources-svq.5) both funnel through createPost — they cannot bypass the
// post + found sibling-row transactional invariant or skip thumbnail
// ingestion. [LAW:dataflow-not-control-flow] one path runs every call; the
// optional thumbnailUrl is data that turns the ingest into a no-op or a one-
// shot R2 write.
async function createFoundPost(
  input: Extract<CreatePostInput, { kind: 'found' }>,
  ctx: { env: Env },
): Promise<Post> {
  const { env } = ctx
  const database = db(env)

  // [LAW:single-enforcer] Every hosted image flows through ingestImage. If a
  // thumbnail was supplied, ingest its bytes BEFORE the post row is written
  // so a failing fetch surfaces as a caller error (4xx-equivalent at the
  // route), not a dangling post row with no thumbnail. The linked content
  // itself is not rehosted — found posts are outbound links, not media we
  // host. The caller supplies w/h (it knows them; the writer doesn't decode
  // image headers) and the writer swaps the externally-hosted url with our
  // content-addressed /media/<key>.
  let thumbnail: Media | undefined
  if (input.thumbnail !== undefined) {
    const ingested = await ingestImage(input.thumbnail.url, env)
    thumbnail = {
      kind: 'image',
      url: ingested.url,
      w: input.thumbnail.w,
      h: input.thumbnail.h,
      ...(input.thumbnail.alt !== undefined ? { alt: input.thumbnail.alt } : {}),
    }
  }

  const id = makePostId(crypto.randomUUID())
  const createdAt = new Date()

  // [LAW:types-are-the-program] Paired batch insert: posts row + its found
  // sibling. D1 batch is not transactional — the success check below is the
  // cardinality enforcer. If the found row does not land, we detect and clean up
  // before returning so feed reads never see a posts row without its sibling.
  // [LAW:no-silent-fallbacks] Same D1 per-statement silent-failure guard as the
  // generation arm: check result.success explicitly, not just absence of throw.
  let postInsertFound: unknown
  let foundInsert: unknown
  try {
    ;[postInsertFound, foundInsert] = await database.batch([
      database.insert(posts).values({
        id,
        createdAt,
        contentKind: 'found',
        originJson: JSON.stringify(input.origin),
      }),
      database.insert(found).values({
        postId: id,
        url: input.url,
        title: input.title,
        description: input.description ?? null,
        thumbnailJson: thumbnail === undefined ? null : JSON.stringify(thumbnail),
      }),
    ])
  } catch (err) {
    emit('slopspot.write.batch_outcome', { content_kind: 'found', outcome: 'failed' }, 1)
    throw err
  }
  const postRawFound = postInsertFound as unknown as { success: boolean; error?: string }
  if (!postRawFound.success) {
    emit('slopspot.write.batch_outcome', { content_kind: 'found', outcome: 'failed' }, 1)
    throw new Error(`posts INSERT failed: ${postRawFound.error ?? 'unknown'}`)
  }
  // D1 batch is not transactional: confirm posts succeeded before deleting to
  // ensure cleanup targets only a row this writer created, not a pre-existing one.
  const foundRaw = foundInsert as unknown as { success: boolean; error?: string }
  if (!foundRaw.success) {
    const foundError = `found INSERT failed: ${foundRaw.error ?? 'unknown'}`
    // [LAW:dataflow-not-control-flow] same pattern as generation arm: cleanupNote
    // is data, emit and throw are unconditional.
    let cleanupNote = ''
    try {
      const cleanupResult = await database.delete(posts).where(eq(posts.id, id))
      const cleanupRaw = cleanupResult as unknown as { success: boolean; error?: string }
      if (!cleanupRaw.success) {
        cleanupNote = `; orphan cleanup also failed: ${cleanupRaw.error ?? 'unknown'}`
      }
    } catch (cleanupErr) {
      cleanupNote = `; orphan cleanup threw: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`
    }
    emit('slopspot.write.batch_outcome', { content_kind: 'found', outcome: 'failed' }, 1)
    throw new Error(`${foundError}${cleanupNote}`)
  }

  emit('slopspot.write.batch_outcome', { content_kind: 'found', outcome: 'success' }, 1)
  // 'found' posts have no provider — style_family is generation-only. Use a
  // sentinel that the dashboard can group/filter by, rather than smuggling a
  // fake style in (which would skew per-style aggregates). The puller treats
  // 'n/a' as the explicit "this dimension does not apply" bucket.
  emit(
    'slopspot.post.created',
    { content_kind: 'found', provider_id: 'n/a', style_family: 'n/a' },
    1,
  )

  return {
    id,
    createdAt,
    origin: input.origin,
    content: {
      kind: 'found',
      url: input.url,
      title: input.title,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(thumbnail !== undefined ? { thumbnail } : {}),
    },
  }
}
