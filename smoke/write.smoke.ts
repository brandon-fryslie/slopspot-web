import { beforeAll, describe, expect, it } from 'vitest'
import { writeTarget, type WriteTarget } from './config'
import { jsonRequest } from './http'

// [LAW:behavior-not-structure] TIER 2 — the mutating verticals as real round-trips
// against a RUNNING server: generate → breed → found, each request → 2xx → the
// artifact exists → it renders. This is the steel-thread coverage the epic wants:
// breed exercises the whole vertical (route → budget → composer → mock provider →
// createPost → R2 → D1 → render), so a regression in any layer fails this within
// minutes instead of when a user hits the error.
//
// [LAW:no-silent-fallbacks] These WRITE real posts, so they target a DEV/STAGING
// server only (SLOPSPOT_ENV=dev, disposable D1/R2, mock providers) — NEVER prod
// (breed's realProviders guard rejects mock media in prod; generate/found would
// pollute the live feed with no delete path). That target is slopspot-breeding-3xe.5
// (staging deploy). Until it exists, writeTarget() throws in beforeAll and this whole
// suite fails LOUD — it never silently passes against nothing. It lights up the moment
// SMOKE_WRITE_BASE_URL is set. (BLOCKED ON slopspot-breeding-3xe.5.)

// A recipe valid by construction: recipeSubjectSchema constrains slot KEYS to the
// template; values are free strings (min 1, max 100). T09 takes one slot. styleFamily
// and aspectRatio are closed enums — these literals are members of both.
const VALID_RECIPE = {
  styleFamily: 'liminal',
  subject: { subjectTemplate: 'T09', slots: { abstractConcept: 'obsolescence' } },
  aspectRatio: '1:1',
} as const

// fal-flux-mock returns a deterministic image URL with no provider cost; realProviders
// admits it only when SLOPSPOT_ENV=dev — which is exactly why this tier is dev-only.
const MOCK_PROVIDER = 'fal-flux-mock'

type GenerateResponse = { postId: string }
type BreedResponse = { id: string; parents: [string, string] }
type FoundResponse = { id: string }
type FeedItem = { post: { id: string; content: { status?: { output?: { url?: string } } } } }
type FeedResponse = { items: FeedItem[] }

// Drive a generation through the mock provider, bypassing the challenge bank with
// the internal token (the documented internal path; the challenge gate's *issuance*
// is covered by the Tier-1 liveness probe). Returns the new post id.
async function seedGeneration(target: WriteTarget, prompt: string): Promise<string> {
  const res = await jsonRequest(`${target.baseUrl}/api/generate`, {
    method: 'POST',
    internalToken: target.internalToken,
    body: {
      challengeId: 'internal-smoke',
      agentId: 'agent:smoke-tier2',
      providerId: MOCK_PROVIDER,
      // params must satisfy the provider's paramsSchema (createPost validates it):
      // fal-flux-mock requires prompt (1..500) + steps (int 1..50). createPost
      // overrides params.prompt with the utterance, but the field must be present.
      params: { prompt, steps: 4 },
      ...VALID_RECIPE,
    },
  })
  expect(res.status, `generate must be 200 (got ${res.status})`).toBe(200)
  const body = (await res.json()) as GenerateResponse
  expect(typeof body.postId).toBe('string')
  return body.postId
}

// A freshly-written post must render through the live read path — its permalink
// returns HTML carrying its own id (the loader resolved it end-to-end).
async function expectRenders(target: WriteTarget, postId: string): Promise<void> {
  const res = await fetch(`${target.baseUrl}/p/${postId}`)
  expect(res.status, `GET /p/${postId} must render (200)`).toBe(200)
  expect(res.headers.get('content-type')).toMatch(/text\/html/)
  const html = await res.text()
  expect(html, 'permalink HTML must carry the post id (loader resolved it)').toContain(postId)
}

// The R2 artifact resolves: find the post in the feed, GET its /media/<key>.
async function expectMediaResolves(target: WriteTarget, postId: string): Promise<void> {
  const res = await jsonRequest(`${target.baseUrl}/api/feed`)
  expect(res.status).toBe(200)
  const body = (await res.json()) as FeedResponse
  const item = body.items.find((i) => i.post.id === postId)
  expect(item, `post ${postId} must appear in the feed`).toBeDefined()
  const url = item!.post.content.status?.output?.url
  expect(typeof url, 'generated post must carry a media url').toBe('string')
  const media = await fetch(`${target.baseUrl}${url}`)
  expect(media.status, 'media object must resolve').toBe(200)
  expect(media.headers.get('content-type')).toMatch(/^image\//)
}

describe('write round-trips (mutating — dev/staging only)', () => {
  let target: WriteTarget
  beforeAll(() => {
    // [LAW:no-silent-fallbacks] Loud failure if the mutating target is unconfigured.
    target = writeTarget()
  })

  it('generate: challenge-gated write → 2xx → artifact exists → renders', async () => {
    const postId = await seedGeneration(target, 'a smoke-test slop of pure obsolescence')
    await expectRenders(target, postId)
    await expectMediaResolves(target, postId)
  })

  it('breed (steel thread): two parents → bred child → 201 → renders', async () => {
    const a = await seedGeneration(target, 'first parent slop')
    const b = await seedGeneration(target, 'second parent slop')

    const res = await jsonRequest(`${target.baseUrl}/api/breed/${a}`, {
      method: 'POST',
      body: { mateId: b },
    })
    expect(res.status, `breed must be 201 (got ${res.status})`).toBe(201)
    const body = (await res.json()) as BreedResponse
    expect(typeof body.id).toBe('string')
    expect(body.parents).toEqual([a, b])
    await expectRenders(target, body.id)
    await expectMediaResolves(target, body.id)
  })

  it('found: submit outbound link → 201 → renders', async () => {
    const res = await jsonRequest(`${target.baseUrl}/api/found`, {
      method: 'POST',
      body: {
        url: 'https://example.com/smoke-found',
        title: 'Smoke-test found slop',
      },
    })
    expect(res.status, `found must be 201 (got ${res.status})`).toBe(201)
    const body = (await res.json()) as FoundResponse
    expect(typeof body.id).toBe('string')
    await expectRenders(target, body.id)
  })
})
