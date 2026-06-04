import { beforeAll, describe, expect, it } from 'vitest'
import { readTarget } from './config'
import { jsonRequest } from './http'

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

  it('homepage: serves HTML', async () => {
    const res = await fetch(`${baseUrl}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
  })

  it('feed: returns renderable items (each post carries an id)', async () => {
    const res = await jsonRequest(`${baseUrl}/api/feed`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as FeedResponse
    expect(body.items.length).toBeGreaterThan(0)
    for (const item of body.items) {
      expect(typeof item.post.id).toBe('string')
      expect(item.post.id.length).toBeGreaterThan(0)
    }
  })

  it('permalink: renders the post page', async () => {
    const res = await fetch(`${baseUrl}/p/${topPostId}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    // The permalink must actually render the post, not a shell — its own id
    // appears in the document (data attr / links), proving the loader resolved it.
    const html = await res.text()
    expect(html).toContain(topPostId)
  })

  it('media: resolves to an image', async () => {
    const res = await fetch(`${baseUrl}${mediaPath}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^image\//)
  })

  it('challenge: issues a challenge', async () => {
    const res = await jsonRequest(`${baseUrl}/api/challenge`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { challengeId?: string; text?: string }
    expect(typeof body.challengeId).toBe('string')
    expect(body.challengeId!.length).toBeGreaterThan(0)
    expect(typeof body.text).toBe('string')
    expect(body.text!.length).toBeGreaterThan(0)
  })

  // [LAW:types-are-the-program] The one prod-safe WRITE probe. Residue-safety is a
  // property of the VOTER IDENTITY, and the probe OWNS that identity as a value: a
  // stable self-reported agentId (the vote route sets voterId = agentId). It is NOT
  // an emergent round-trip artifact — an earlier version voted cookie-less, which
  // minted a FRESH random anon voter every run, so any failure-path strand (retract
  // throws / process killed) accumulated UNBOUNDED distinct +1 voters on the live
  // feed. With one stable agentId the bad state is unrepresentable: exactly one smoke
  // voter ever, PK-capped to ≤1 vote per post, and the next run's retract on the same
  // id self-heals any strand. The finally clause closes the within-run window so a
  // mid-probe assertion throw can never leave the +1 behind.
  //
  // [LAW:behavior-not-structure] Asserts the wire contract (value 1 → null on retract,
  // score is a number) — never the absolute score, which other live votes race.
  //
  // (Deterministic-post hardening — probe a fixed post so self-heal is EXACT on one
  // known row — is intentionally NOT done: /api/feed serves only the Hot window
  // (no ascending-createdAt sort), so there is no stable anchor in the public API and
  // a hardcoded prod post id would be brittle. agentId + finally already removes the
  // unbounded accumulation; the residual is ≤1 vote on one post only on a hard process
  // kill mid-probe, self-healed when that post is next probed.)
  const SMOKE_VOTER = 'agent:smoke-liveness'
  it('vote: upvote then retract under one owned identity, zero residue', async () => {
    const voteUrl = `${baseUrl}/api/posts/${topPostId}/vote`
    try {
      const up = await jsonRequest(voteUrl, { method: 'POST', body: { value: 1, agentId: SMOKE_VOTER } })
      expect(up.status, 'upvote must be 200').toBe(200)
      const upBody = (await up.json()) as VoteResponse
      expect(upBody.value).toBe(1)
      expect(typeof upBody.score).toBe('number')

      const down = await jsonRequest(voteUrl, { method: 'POST', body: { value: 0, agentId: SMOKE_VOTER } })
      expect(down.status, 'retract must be 200').toBe(200)
      const downBody = (await down.json()) as VoteResponse
      // value:0 retracts → the vote row is deleted → the returned current vote is
      // null (not 0). That null IS the proof the probe left no residue on the feed.
      expect(downBody.value, 'retract removes the vote (current vote is null)').toBeNull()
    } finally {
      // [LAW:no-silent-fallbacks] Best-effort cleanup so a throw between the upvote
      // and the in-body retract never strands the +1. Idempotent under the stable
      // agentId (a no-op retract returns value:null). A cleanup failure is logged
      // loud, not swallowed, and never masks the test's own result.
      try {
        await jsonRequest(voteUrl, { method: 'POST', body: { value: 0, agentId: SMOKE_VOTER } })
      } catch (err) {
        console.warn('[smoke] vote-probe cleanup retract failed (residue may persist until next run)', err)
      }
    }
  })
})
