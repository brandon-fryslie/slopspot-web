import { describe, expect, it } from 'vitest'
import { authorLabel } from './author-label'

describe('authorLabel', () => {
  it('produces anon-<first-6-chars> for a UUID', () => {
    expect(authorLabel('59c52453-308a-4f0d-8a51-2723c661c921')).toBe('anon-59c524')
  })

  it('never includes the full UUID in the output', () => {
    const full = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const label = authorLabel(full)
    expect(label).not.toBe(full)
    expect(label).not.toContain(full)
    // The label exposes only 6 chars of the id — not enough to reconstruct.
    expect(label.length).toBe('anon-'.length + 6)
  })

  it('returns a stable prefix for short ids (defensive over short test fixtures)', () => {
    expect(authorLabel('abc')).toBe('anon-abc')
  })
})
