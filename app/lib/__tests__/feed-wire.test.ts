// [LAW:behavior-not-structure] The wire→domain contract for client-fetched feed pages: /api/feed
// serializes Dates to ISO strings (Response.json), and reviveFeedItem reconstructs the one Date the
// domain (and the card's relativeTime) requires. This is the automated regression guard for the
// browser-caught crash (ff1bdb8) — a refactor that drops the revival fails here, in the suite,
// instead of only in a browser the suite can't drive.

import { describe, expect, it } from 'vitest'
import { reviveFeedItem, type WireFeedItem } from '~/lib/feed-wire'

// A representative wire row exactly as JSON.parse yields it: post.createdAt is a STRING. Built
// minimally — reviveFeedItem reads post.createdAt and passes the rest through, so the fixture pins
// one Date plus a few passthrough fields. The cast is the test boundary asserting "this is the wire
// shape," not a production launder.
const wire = {
  post: {
    id: 'post-abc',
    createdAt: '2026-06-04T12:00:00.000Z',
    origin: { kind: 'authored', author: { kind: 'agent', agentId: 'sys:test' } },
    content: { kind: 'found', url: 'https://example.com/x', title: 't' },
  },
  score: 5,
  myVote: 1,
  commentCount: 2,
  viewerIsModifier: false,
  rank: 3,
} as unknown as WireFeedItem

describe('reviveFeedItem', () => {
  it('revives post.createdAt from an ISO string into a Date at the same instant', () => {
    const item = reviveFeedItem(wire)
    expect(item.post.createdAt).toBeInstanceOf(Date)
    expect(item.post.createdAt.getTime()).toBe(Date.parse('2026-06-04T12:00:00.000Z'))
  })

  it('passes every other field through unchanged (the inverse of the wire serialization, nothing more)', () => {
    const item = reviveFeedItem(wire)
    expect(item.post.id).toBe('post-abc')
    expect(item.score).toBe(5)
    expect(item.myVote).toBe(1)
    expect(item.commentCount).toBe(2)
    expect(item.rank).toBe(3)
    expect(item.post.content).toEqual({ kind: 'found', url: 'https://example.com/x', title: 't' })
  })

  it('does not mutate the input wire row', () => {
    const original = wire.post.createdAt
    reviveFeedItem(wire)
    expect(wire.post.createdAt).toBe(original) // still the original string; revive returns a fresh object
  })

  it('the revived createdAt survives the .getTime() the card crashed on (the ff1bdb8 regression)', () => {
    const item = reviveFeedItem(wire)
    // relativeTime(post.createdAt) calls .getTime(); a string would throw "d.getTime is not a function".
    expect(() => item.post.createdAt.getTime()).not.toThrow()
  })
})
