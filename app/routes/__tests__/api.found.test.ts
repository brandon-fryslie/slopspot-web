// [LAW:behavior-not-structure] These tests pin /api/found's *contract* — the
// status-code map and the side-effects on D1 / cookies / quota. They are
// deliberately blind to the action handler's internal shape (Zod schema
// names, the order of gates beyond what status codes reveal). A refactor
// that keeps the contract intact must not require editing these tests, and
// a refactor that drifts must fail them.
//
// [LAW:types-are-the-program] The action runs against real D1 (workers
// project) so the createPost → posts/found row round-trip and the
// found_submission_quota write are exercised by real SQL, not mocks.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { action } from '~/routes/api.found'
import { FOUND_DAILY_CAP } from '~/lib/found-quota'
import { getPostById } from '~/db/feed'
import { PostId } from '~/lib/domain'

// The `ProvidedEnv` augmentation is declared once in app/db/__tests__/setup.ts
// (loaded via vitest setupFiles). Module augmentations are global within a
// TypeScript compilation, so individual test files do not redeclare it.

const stubCtx: ExecutionContext = {
  waitUntil() {},
  passThroughOnException() {},
  exports: {} as Cloudflare.Exports,
  props: {},
}

// [LAW:types-are-the-program] Helper that builds an ActionArgs shaped like
// RR7 would hand to the route. The action only reads `request` and
// `context.cloudflare.env`; everything else is structural padding the
// CreateServerActionArgs type requires. Same shape as media.key.test.ts.
function actionArgs(init: {
  method?: string
  body?: string
  contentType?: string
  origin?: string
  cookie?: string
}): Parameters<typeof action>[0] {
  const url = new URL('https://slopspot.ai/api/found')
  const headers: Record<string, string> = {}
  if (init.contentType !== undefined) headers['content-type'] = init.contentType
  if (init.origin !== undefined) headers['origin'] = init.origin
  if (init.cookie !== undefined) headers['cookie'] = init.cookie
  return {
    params: {},
    context: { cloudflare: { env, ctx: stubCtx } },
    request: new Request(url, {
      method: init.method ?? 'POST',
      body: init.body,
      headers,
    }),
    url,
    pattern: '/api/found',
  } as Parameters<typeof action>[0]
}

const VALID_BODY = JSON.stringify({
  url: 'https://civitai.com/images/12345',
  title: 'a found slop',
  description: 'optional words',
})

describe('POST /api/found - method gate', () => {
  it('returns 405 for GET', async () => {
    const res = await action(
      actionArgs({ method: 'GET' }),
    )
    expect(res.status).toBe(405)
  })
})

describe('POST /api/found - same-origin gate', () => {
  it('returns 403 when Origin is cross-site', async () => {
    const res = await action(
      actionArgs({
        body: VALID_BODY,
        contentType: 'application/json',
        origin: 'https://evil.example',
      }),
    )
    expect(res.status).toBe(403)
  })

  it('accepts an absent Origin header (server-to-server)', async () => {
    const res = await action(
      actionArgs({ body: VALID_BODY, contentType: 'application/json' }),
    )
    // Absent Origin → treated as same-origin per ~/lib/same-origin. Cannot
    // be 403; should reach the writer and produce 201.
    expect(res.status).toBe(201)
  })
})

describe('POST /api/found - body parse', () => {
  it('returns 400 on malformed JSON', async () => {
    const res = await action(
      actionArgs({ body: 'not json', contentType: 'application/json' }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 on a malformed URL value (Zod rejects "not-a-url")', async () => {
    const res = await action(
      actionArgs({
        body: JSON.stringify({ url: 'not-a-url', title: 'ok' }),
        contentType: 'application/json',
      }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when title is missing', async () => {
    const res = await action(
      actionArgs({
        body: JSON.stringify({ url: 'https://example.com' }),
        contentType: 'application/json',
      }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when title is whitespace-only (trims to empty)', async () => {
    const res = await action(
      actionArgs({
        body: JSON.stringify({ url: 'https://example.com', title: '   ' }),
        contentType: 'application/json',
      }),
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/found - success path', () => {
  it('returns 201 with the post id and writes a found row to D1', async () => {
    const res = await action(
      actionArgs({
        body: VALID_BODY,
        contentType: 'application/json',
      }),
    )
    expect(res.status).toBe(201)
    const json = (await res.json()) as { id: string }
    expect(typeof json.id).toBe('string')
    expect(json.id.length).toBeGreaterThan(0)

    // [LAW:behavior-not-structure] Read back via getPostById — the public
    // reader. We test the contract (a 'found' post with our url/title is now
    // visible to the feed), not the writer's column choices.
    const post = await getPostById(env, PostId(json.id))
    expect(post).not.toBeNull()
    if (post !== null) {
      expect(post.content.kind).toBe('found')
      if (post.content.kind === 'found') {
        expect(post.content.url).toBe('https://civitai.com/images/12345')
        expect(post.content.title).toBe('a found slop')
        expect(post.content.description).toBe('optional words')
      }
    }
  })

  it('sets the voter cookie on the response when none was sent', async () => {
    const res = await action(
      actionArgs({
        body: JSON.stringify({
          url: 'https://example.com/a',
          title: 'first submission',
        }),
        contentType: 'application/json',
      }),
    )
    expect(res.status).toBe(201)
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).not.toBeNull()
    expect(setCookie).toContain('slopspot_voter=')
  })

  it('normalizes empty-after-trim description to absent (no "" stored)', async () => {
    // [LAW:types-are-the-program] The schema's preprocess collapses both
    // "" and whitespace-only descriptions to undefined so storage never
    // holds a "present-but-blank" description that PostCard would render
    // as an empty paragraph. Asserted via round-trip through getPostById.
    for (const blank of ['', '   ', '\n\t  ']) {
      const res = await action(
        actionArgs({
          body: JSON.stringify({
            url: `https://example.com/blank-${blank.length}`,
            title: `blank desc len ${blank.length}`,
            description: blank,
          }),
          contentType: 'application/json',
        }),
      )
      expect(res.status).toBe(201)
      const { id } = (await res.json()) as { id: string }
      const post = await getPostById(env, PostId(id))
      expect(post).not.toBeNull()
      if (post !== null && post.content.kind === 'found') {
        expect(post.content.description).toBeUndefined()
      }
    }
  })
})

describe('POST /api/found - rate limit', () => {
  it('returns 429 after FOUND_DAILY_CAP submissions from the same cookie', async () => {
    // Pin the voter id via a pre-existing cookie so each call shares the
    // same quota row. (Without a cookie the route mints a fresh UUID every
    // call and each voter has their own counter — wouldn't exercise the cap.)
    const voterId = '11111111-2222-3333-4444-555555555555'
    const cookie = `slopspot_voter=${voterId}`

    for (let i = 0; i < FOUND_DAILY_CAP; i++) {
      const res = await action(
        actionArgs({
          body: JSON.stringify({
            url: `https://example.com/${i}`,
            title: `submission ${i}`,
          }),
          contentType: 'application/json',
          cookie,
        }),
      )
      expect(res.status).toBe(201)
    }

    // (cap+1)th call exhausts the quota.
    const res = await action(
      actionArgs({
        body: JSON.stringify({
          url: 'https://example.com/over-cap',
          title: 'one too many',
        }),
        contentType: 'application/json',
        cookie,
      }),
    )
    expect(res.status).toBe(429)
    const json = (await res.json()) as { error: string; retryAfter: string }
    expect(json.error).toBe('rate limited')
    expect(new Date(json.retryAfter).getTime()).toBeGreaterThan(Date.now())
  })
})
