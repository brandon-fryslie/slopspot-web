// [LAW:single-enforcer] The one place a Post comes into existence. Every writer —
// the /api/generate route, the firehose cron, the bootstrap script, future
// submission UI — funnels through createPost. The provider call, R2 ingestion,
// and the generations status lifecycle live here exactly once, so they cannot
// drift per-callsite.

import { eq } from 'drizzle-orm'
import { db } from '~/db/client'
import { generations, posts } from '~/db/schema'
import { getProvider } from '~/providers'
import { ingestImage } from '~/storage/ingest'
import type { Media, Origin, Post, PostId, ProviderId } from '~/lib/domain'
import { PostId as makePostId } from '~/lib/domain'

export type CreatePostInput = {
  providerId: ProviderId
  params: unknown
  origin: Origin
  parentId?: PostId
}

export async function createPost(
  input: CreatePostInput,
  ctx: { env: Env },
): Promise<Post> {
  const { env } = ctx
  const database = db(env)

  // [LAW:single-enforcer] Provider lookup + param validation cross the registry's
  // trust boundary here. Both throw before any row is written (unknown provider /
  // bad params are caller errors, not failed generations), so neither leaves a
  // dangling row.
  const provider = getProvider(input.providerId)
  const params = provider.paramsSchema.parse(input.params)

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
  await database.batch([
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
      status: 'running',
      startedAt,
    }),
  ])

  let output: Media
  let completedAt: Date
  try {
    const generated = await provider.generate(params, { env })
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
        failedReason: err instanceof Error ? err.message : String(err),
      })
      .where(eq(generations.postId, id))
    throw err
  }

  // [LAW:types-are-the-program] running → succeeded: clear started_at, set the
  // succeeded arm (completed_at + output_json).
  await database
    .update(generations)
    .set({
      status: 'succeeded',
      startedAt: null,
      completedAt,
      outputJson: JSON.stringify(output),
    })
    .where(eq(generations.postId, id))

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
        parentId: input.parentId,
      },
      status: { kind: 'succeeded', output, completedAt },
    },
  }
}
