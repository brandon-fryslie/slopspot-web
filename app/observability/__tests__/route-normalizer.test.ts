import { describe, expect, it } from 'vitest'
import { normalizeRoute } from '~/observability/route-normalizer'

// [LAW:behavior-not-structure] Tests assert the CONTRACT: known URL patterns map to
// stable metric labels; unknown URLs map to 'unknown' rather than leaking raw paths.

describe('normalizeRoute', () => {
  it('maps the root to "home"', () => {
    expect(normalizeRoute('/')).toBe('home')
  })

  it('maps static API routes', () => {
    expect(normalizeRoute('/api/feed')).toBe('api.feed')
    expect(normalizeRoute('/api/challenge')).toBe('api.challenge')
    expect(normalizeRoute('/api/generate')).toBe('api.generate')
    expect(normalizeRoute('/api/rewrite-prompt')).toBe('api.rewrite-prompt')
    expect(normalizeRoute('/api/found')).toBe('api.found')
    expect(normalizeRoute('/api/well')).toBe('api.well')
  })

  it('maps API feed with query string', () => {
    expect(normalizeRoute('/api/feed?voterId=abc&sort=hot')).toBe('api.feed')
  })

  it('strips dynamic post IDs', () => {
    expect(normalizeRoute('/p/abc123defg456')).toBe('p.$id')
    expect(normalizeRoute('/api/posts/xyz789/vote')).toBe('api.posts.$id.vote')
    expect(normalizeRoute('/api/posts/xyz789/comments')).toBe('api.posts.$id.comments')
    expect(normalizeRoute('/api/fork/xyz789')).toBe('api.fork.$id')
    expect(normalizeRoute('/api/breed/xyz789')).toBe('api.breed.$id')
    expect(normalizeRoute('/fork/xyz789')).toBe('fork.$id')
    expect(normalizeRoute('/breed/xyz789')).toBe('breed.$id')
  })

  it('strips dynamic media keys', () => {
    expect(normalizeRoute('/media/sha256hexstring')).toBe('media.$key')
  })

  it('strips dynamic handles', () => {
    expect(normalizeRoute('/cast/the-curator')).toBe('cast.$handle')
    expect(normalizeRoute('/api/cast/the-curator/back')).toBe('api.cast.$handle.back')
  })

  it('maps the cast index', () => {
    expect(normalizeRoute('/cast')).toBe('cast._index')
  })

  it('maps page routes', () => {
    expect(normalizeRoute('/health')).toBe('health')
    expect(normalizeRoute('/metrics')).toBe('metrics')
    expect(normalizeRoute('/well')).toBe('well')
    expect(normalizeRoute('/submit')).toBe('submit')
    expect(normalizeRoute('/about/agents')).toBe('about.agents')
    expect(normalizeRoute('/admin/personas')).toBe('admin.personas')
  })

  it('returns "unknown" for unrecognized paths', () => {
    expect(normalizeRoute('/does-not-exist')).toBe('unknown')
    expect(normalizeRoute('/api/v2/something')).toBe('unknown')
    expect(normalizeRoute('')).toBe('unknown')
  })
})
