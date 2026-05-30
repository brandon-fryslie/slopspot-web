// [LAW:single-enforcer] The one place a Post comes into existence. Every writer —
// the /api/generate route, the firehose cron, the bootstrap script, future
// submission UI — funnels through createPost. The provider call, R2 ingestion,
// and the generations status lifecycle live here exactly once, so they cannot
// drift per-callsite.

import { eq } from 'drizzle-orm'
import type { ZodError, ZodIssue } from 'zod'
import { db } from '~/db/client'
import { found, generations, posts } from '~/db/schema'
import { emit } from '~/observability/metrics'
import { getProvider } from '~/providers'
import { ingestImage } from '~/storage/ingest'
import type {
  AspectRatio,
  Media,
  Origin,
  Post,
  PostId,
  ProviderId,
  RecipeSubject,
  StyleFamily,
} from '~/lib/domain'
import { PostId as makePostId } from '~/lib/domain'

// [LAW:types-are-the-program] CreatePostInput is a discriminated union — the
// variant the caller wants to write IS the input shape, not a flag inside it.
// Adding 'found' here forces every call site to declare which Content arm it
// is producing, and the writer switches on that discriminator to do the right
// work. No "generation by default" implicit case; the type forbids ambiguity.
export type CreatePostInput =
  | {
      kind: 'generation'
      providerId: ProviderId
      params: unknown
      styleFamily: StyleFamily
      subject: RecipeSubject
      aspectRatio: AspectRatio
      origin: Origin
      parentId?: PostId
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
      origin: Origin
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

async function createGenerationPost(
  input: Extract<CreatePostInput, { kind: 'generation' }>,
  ctx: { env: Env },
): Promise<Post> {
  const { env } = ctx
  const database = db(env)

  // [LAW:single-enforcer] Provider lookup + param validation cross the registry's
  // trust boundary here. Both throw before any row is written (unknown provider /
  // bad params are caller errors, not failed generations), so neither leaves a
  // dangling row.
  const provider = getProvider(input.providerId)
  const validated = provider.paramsSchema.safeParse(input.params)
  if (!validated.success) {
    throw new InvalidParamsError(provider.id, validated.error)
  }
  const params = validated.data

  const id = makePostId(crypto.randomUUID())
  const startedAt = new Date()

  // [LAW:types-are-the-program] Pre-insert as 'running' before calling the
  // provider, so a provider failure (or a worker crash mid-generation) leaves an
  // observable row rather than nothing. createPost is synchronous — it starts the
  // generation immediately — so 'running' is the true state from insert until the
  // provider resolves; it never persists 'pending' (a queued-not-started state no
  // synchronous caller occupies). The paired insert is batched in one transaction
  // so a content_kind='generation' post can never exist without its generations
  // row — the cross-table cardinality this writer owns.
  const [, genInsert] = await database.batch([
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
      parentPostId: input.parentId ?? null,
      styleFamily: input.styleFamily,
      subjectTemplate: input.subject.subjectTemplate,
      slotsJson: JSON.stringify(input.subject.slots),
      aspectRatio: input.aspectRatio,
      status: 'running',
      startedAt,
    }),
  ])
  // [LAW:no-silent-fallbacks] drizzle's mapRunResult never checks D1Result.success,
  // so per-statement failures inside a batch silently resolve without throwing.
  // Cast to the raw D1Result shape and fail loud — the orphan-post incident (May 2026)
  // was caused by exactly this silent path.
  const genRaw = genInsert as unknown as { success: boolean; error?: string }
  if (!genRaw.success) {
    throw new Error(`generations INSERT failed: ${genRaw.error ?? 'unknown'}`)
  }

  let output: Media
  let completedAt: Date
  const generateStartedMs = Date.now()
  try {
    const generated = await provider.generate(
      { params, aspectRatio: input.aspectRatio },
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
      style_family: input.styleFamily,
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
      recipe: {
        providerId: provider.id,
        providerVersion: provider.version,
        params,
        styleFamily: input.styleFamily,
        aspectRatio: input.aspectRatio,
        subject: input.subject,
        parentId: input.parentId,
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

  // [LAW:types-are-the-program] Paired insert in one transaction: posts row +
  // its found sibling. The cross-table cardinality (a content_kind='found'
  // post has exactly one matching found row) is the writer's invariant, the
  // same shape as the generation arm.
  // [LAW:no-silent-fallbacks] Same D1 per-statement silent-failure guard as the
  // generation arm: check result.success explicitly, not just absence of throw.
  let foundInsert: unknown
  try {
    ;[, foundInsert] = await database.batch([
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
  const foundRaw = foundInsert as unknown as { success: boolean; error?: string }
  if (!foundRaw.success) {
    emit('slopspot.write.batch_outcome', { content_kind: 'found', outcome: 'failed' }, 1)
    throw new Error(`found INSERT failed: ${foundRaw.error ?? 'unknown'}`)
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
