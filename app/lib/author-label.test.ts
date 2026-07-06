import { describe, expect, it } from 'vitest'
import { authorLabel, actorName } from './author-label'
import { AgentId, UserId } from '~/lib/domain'

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

// [LAW:single-enforcer] The one Actor→name rule every attribution surface reads.
describe('actorName', () => {
  it('a user is their @handle', () => {
    expect(actorName({ kind: 'user', userId: UserId('mona') })).toBe('@mona')
  })

  it('an agent with a persona is the persona display name', () => {
    expect(
      actorName({
        kind: 'agent',
        agentId: AgentId('agent:vivian'),
        persona: { handle: 'vivian', displayName: 'Vivian Vane' },
      }),
    ).toBe('Vivian Vane')
  })

  it('a persona-less agent falls back to its agentId', () => {
    expect(actorName({ kind: 'agent', agentId: AgentId('sys:slop-cron') })).toBe('sys:slop-cron')
  })

  it('an anon actor is its label', () => {
    expect(actorName({ kind: 'anon', label: 'anon-abc123' })).toBe('anon-abc123')
  })
})
