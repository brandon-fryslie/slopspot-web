import { beforeAll, describe, expect, it } from 'vitest'
import { readTarget } from './config'
import { cookieJarFromResponse, jsonRequest } from './http'

// [LAW:behavior-not-structure] TIER 1 — the live-server liveness probe. Every
// assertion is the public HTTP contract a real user/agent depends on: the
// homepage serves HTML, the feed serves renderable items, a permalink renders,
// a media object resolves to an image, the challenge gate issues, and the vote
// write-path accepts + retracts. No internals. This is the gap unit tests can't
// cover — it catches "feed down while /health up" within minutes, against the
// ACTUAL running server, on a schedule + on deploy.
//
// PROD-SAFE by construction: only GETs, plus a vote that upvotes then retracts
// with the SAME voter cookie (value:0) — zero residue on the live feed. No paid
// provider call, no permanent write. The cost story (see smoke/config.ts) keeps
// every mutating vertical out of this tier; they live in write.smoke.ts (Tier 2).

const { baseUrl } = readTarget()

// The feed's shape is the contract; narrow to exactly what the probe reads.
type FeedItem = {
  post: {
    id: string
    content: {
      kind: string
      status?: { kind: string; output?: { kind: string; url: string } }
    }
  }
}
type FeedResponse = { items: FeedItem[] }
// setVote returns the stored VoteValue (-1 | 1) or null after a retract (the
// row is deleted) — the value field round-trips the voter's *current* vote.
type VoteResponse = { score: number; value: number | null }

describe('liveness (read-only, prod-safe)', () => {
  // One feed fetch feeds the permalink/media/vote probes — and is itself the
  // feed-renders assertion. A live feed with at least one succeeded generation
  // is the prod invariant; its absence is itself an alert-worthy liveness failure
  // (fail loud here rather than silently skip the dependent probes).
  let topPostId: string
  let mediaPath: string

  beforeAll(async () => {
    const res = await jsonRequest(`${baseUrl}/api/feed`)
    expect(res.status, 'GET /api/feed must be 200').toBe(200)
    const body = (await res.json()) as FeedResponse
    expect(Array.isArray(body.items), '/api/feed must return an items array').toBe(true)

    const renderable = body.items.find(
      (i) =>
        i.post.content.kind === 'generation' &&
        i.post.content.status?.kind === 'succeeded' &&
        typeof i.post.content.status?.output?.url === 'string',
    )
    if (renderable === undefined) {
      throw new Error(
        '[smoke] live feed has no succeeded generation post to probe — the firehose or read path is broken',
      )
    }
    topPostId = renderable.post.id
    mediaPath = renderable.post.content.status!.output!.url
  })

  it('GET / serves the homepage as HTML', async () => {
    const res = await fetch(`${baseUrl}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
  })

  it('GET /api/feed returns renderable items (each post carries an id)', async () => {
    const res = await jsonRequest(`${baseUrl}/api/feed`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as FeedResponse
    expect(body.items.length).toBeGreaterThan(0)
    for (const item of body.items) {
      expect(typeof item.post.id).toBe('string')
      expect(item.post.id.length).toBeGreaterThan(0)
    }
  })

  it('GET /p/:id renders the permalink page', async () => {
    const res = await fetch(`${baseUrl}/p/${topPostId}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    // The permalink must actually render the post, not a shell — its own id
    // appears in the document (data attr / links), proving the loader resolved it.
    const html = await res.text()
    expect(html).toContain(topPostId)
  })

  it('GET /media/:key resolves to an image', async () => {
    const res = await fetch(`${baseUrl}${mediaPath}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^image\//)
  })

  it('GET /api/challenge issues a challenge', async () => {
    const res = await jsonRequest(`${baseUrl}/api/challenge`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { challengeId?: string; text?: string }
    expect(typeof body.challengeId).toBe('string')
    expect(body.challengeId!.length).toBeGreaterThan(0)
    expect(typeof body.text).toBe('string')
    expect(body.text!.length).toBeGreaterThan(0)
  })

  // [LAW:behavior-not-structure] The one prod-safe WRITE probe: exercise the vote
  // path end-to-end and leave NO residue. Upvote mints a voter cookie; retract
  // (value:0) with that SAME cookie removes exactly this vote. Asserts the wire
  // contract (value round-trips 1 → 0, score is a number) without asserting the
  // absolute score (other live votes race it — asserting a delta would be flaky).
  it('vote write-path: upvote then retract, zero residue', async () => {
    const voteUrl = `${baseUrl}/api/posts/${topPostId}/vote`

    const up = await jsonRequest(voteUrl, { method: 'POST', body: { value: 1 } })
    expect(up.status, 'upvote must be 200').toBe(200)
    const upBody = (await up.json()) as VoteResponse
    expect(upBody.value).toBe(1)
    expect(typeof upBody.score).toBe('number')

    // The voter cookie minted by the upvote MUST thread into the retract, or the
    // retract acts as a different anonymous voter and cancels nothing (leaving a
    // +1 residue). Asserting it is present also proves the anon-voter cookie mint.
    const cookie = cookieJarFromResponse(up)
    expect(cookie, 'upvote must mint a voter cookie to thread into the retract').not.toBeNull()

    const down = await jsonRequest(voteUrl, { method: 'POST', cookie, body: { value: 0 } })
    expect(down.status, 'retract must be 200').toBe(200)
    const downBody = (await down.json()) as VoteResponse
    // value:0 retracts → the vote row is deleted → the returned current vote is
    // null (not 0). That null IS the proof the probe left no residue on the feed.
    expect(downBody.value, 'retract removes the vote (current vote is null)').toBeNull()
  })
})
