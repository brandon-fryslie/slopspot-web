// [LAW:single-enforcer] One helper module for seeding D1 rows in tests. Every
// D1-backed test inserts through these — no parallel "raw drizzle insert" call
// scattered across test files, so a schema change lands in one helper and
// every test sees it.
//
// [LAW:types-are-the-program] These helpers accept domain-shaped opts
// (GenerationStatus, RecipeSubject, Origin) and emit storage-shaped rows. The
// inverse of feed.ts's storage→domain mapping: tests express intent in domain
// terms and the helper translates to columns. The status switch mirrors
// createPost's write-time per-arm column projection (app/db/posts.ts), but
// without the provider-call side effects that make createPost unsuitable for
// hermetic tests.

import { db } from '~/db/client'
import { comments, found, generations, posts, uploads, votes } from '~/db/schema'
import {
  AgentId,
  PostId,
  type GenerationStatus,
  type Media,
  type Origin,
  type RecipeSubject,
  type StyleFamily,
  type VoteValue,
} from '~/lib/domain'
import type { AspectRatio } from '~/lib/variety'

const DEFAULT_IMAGE: Media = {
  kind: 'image',
  url: '/media/' + 'a'.repeat(64),
  w: 1024,
  h: 1024,
}

// [LAW:types-are-the-program] Default is an AUTHORED origin with a persona author —
// the dominant case and the only one valid for the default generation content. The
// reader maps this single principal actor per content kind (author / finder /
// uploader), so it seeds every kind without a per-kind default.
const DEFAULT_ORIGIN: Origin = {
  kind: 'authored',
  author: { kind: 'agent', agentId: AgentId('sys:test') },
}

const DEFAULT_SUBJECT: RecipeSubject = {
  subjectTemplate: 'T00',
  slots: { freeText: 'a test prompt' },
}

const DEFAULT_STATUS: GenerationStatus = {
  kind: 'succeeded',
  output: DEFAULT_IMAGE,
  completedAt: new Date('2026-01-01T00:00:00Z'),
}

export type SeedGenerationOpts = {
  status?: GenerationStatus
  styleFamily?: StyleFamily
  aspectRatio?: AspectRatio
  subject?: RecipeSubject
  providerId?: string
  providerVersion?: string
  params?: unknown
  parentId?: PostId
  // The human WISH (provenance). Optional: only Well-born generations carry it;
  // omitting it seeds a NULL column, the default for every other genesis.
  wish?: string
}

export type SeedFoundOpts = {
  url?: string
  title?: string
  description?: string
  thumbnail?: Media
}

export type SeedPostContent =
  | ({ kind: 'generation' } & SeedGenerationOpts)
  | { kind: 'upload'; asset?: Media }
  | ({ kind: 'found' } & SeedFoundOpts)

export type SeedPostOpts = {
  id?: string
  createdAt?: Date
  origin?: Origin
  content?: SeedPostContent
}

// [LAW:types-are-the-program] Exhaustiveness guard for the status discriminator
// — mirrors feed.ts's `assertNever`. In the default arm `value` narrows to
// `never`, so this compiles only while every GenerationStatus variant is
// handled. Adding a variant in app/lib/domain.ts breaks the build at the
// `: never` assignment, not at runtime by spreading `undefined` columns.
function assertNever(value: never, what: string): never {
  throw new Error(`helpers: unexpected ${what} at seed boundary: ${String(value)}`)
}

// [LAW:types-are-the-program] One per-arm projection from GenerationStatus to
// the column shape the generations_status_shape CHECK demands. Mirrors
// createPost's transition logic but applies it at insert time (no running →
// succeeded second update), since tests pre-stage the final state.
function statusColumns(status: GenerationStatus) {
  switch (status.kind) {
    case 'pending':
      return {
        status: 'pending' as const,
        queuedAt: status.queuedAt,
        startedAt: null,
        completedAt: null,
        outputJson: null,
        failedAt: null,
        failedReason: null,
      }
    case 'running':
      return {
        status: 'running' as const,
        queuedAt: null,
        startedAt: status.startedAt,
        completedAt: null,
        outputJson: null,
        failedAt: null,
        failedReason: null,
      }
    case 'succeeded':
      return {
        status: 'succeeded' as const,
        queuedAt: null,
        startedAt: null,
        completedAt: status.completedAt,
        outputJson: JSON.stringify(status.output),
        failedAt: null,
        failedReason: null,
      }
    case 'failed':
      return {
        status: 'failed' as const,
        queuedAt: null,
        startedAt: null,
        completedAt: null,
        outputJson: null,
        failedAt: status.failedAt,
        failedReason: status.reason,
      }
    default:
      return assertNever(status, 'GenerationStatus arm')
  }
}

// [LAW:types-are-the-program] Exhaustiveness guard for SeedPostContent — the
// switch mirrors createPost's storage-side discriminator. Adding a Content
// variant fires this `: never` assignment in the default arm before runtime.
function assertNeverContent(value: never, what: string): never {
  throw new Error(`helpers: unexpected ${what} at seed boundary: ${String(value)}`)
}

export async function seedPost(env: Env, opts: SeedPostOpts = {}): Promise<PostId> {
  const database = db(env)
  const id = opts.id ?? crypto.randomUUID()
  const createdAt = opts.createdAt ?? new Date('2026-01-01T00:00:00Z')
  const origin = opts.origin ?? DEFAULT_ORIGIN
  const content: SeedPostContent = opts.content ?? { kind: 'generation' }

  switch (content.kind) {
    case 'upload': {
      const asset = content.asset ?? DEFAULT_IMAGE
      await database.batch([
        database.insert(posts).values({
          id,
          createdAt,
          contentKind: 'upload',
          originJson: JSON.stringify(origin),
        }),
        database
          .insert(uploads)
          .values({ postId: id, assetJson: JSON.stringify(asset) }),
      ])
      return PostId(id)
    }
    case 'found': {
      await database.batch([
        database.insert(posts).values({
          id,
          createdAt,
          contentKind: 'found',
          originJson: JSON.stringify(origin),
        }),
        database.insert(found).values({
          postId: id,
          url: content.url ?? 'https://example.com/found',
          title: content.title ?? 'a found post',
          description: content.description ?? null,
          thumbnailJson:
            content.thumbnail === undefined ? null : JSON.stringify(content.thumbnail),
        }),
      ])
      return PostId(id)
    }
    case 'generation': {
      const status = content.status ?? DEFAULT_STATUS
      const subject = content.subject ?? DEFAULT_SUBJECT

      await database.batch([
        database.insert(posts).values({
          id,
          createdAt,
          contentKind: 'generation',
          originJson: JSON.stringify(origin),
        }),
        database.insert(generations).values({
          postId: id,
          providerId: content.providerId ?? 'fal-flux',
          providerVersion: content.providerVersion ?? '1.0',
          paramsJson: JSON.stringify(content.params ?? { prompt: 'a test prompt' }),
          parentPostId: content.parentId ?? null,
          styleFamily: content.styleFamily ?? 'photoreal',
          subjectTemplate: subject.subjectTemplate,
          slotsJson: JSON.stringify(subject.slots),
          aspectRatio: content.aspectRatio ?? '1:1',
          wish: content.wish ?? null,
          ...statusColumns(status),
        }),
      ])
      return PostId(id)
    }
    default:
      return assertNeverContent(content, 'SeedPostContent arm')
  }
}

export async function seedVote(
  env: Env,
  opts: { postId: PostId; voterId: string; value: VoteValue; createdAt?: Date },
): Promise<void> {
  await db(env)
    .insert(votes)
    .values({
      postId: opts.postId,
      voterId: opts.voterId,
      value: opts.value,
      createdAt: opts.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    })
}

export async function seedComment(
  env: Env,
  opts: {
    id?: string
    postId: PostId
    authorId?: string
    body?: string
    createdAt?: Date
  },
): Promise<string> {
  const id = opts.id ?? crypto.randomUUID()
  await db(env)
    .insert(comments)
    .values({
      id,
      postId: opts.postId,
      authorId: opts.authorId ?? 'anon-tester',
      body: opts.body ?? 'a test comment',
      createdAt: opts.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    })
  return id
}
