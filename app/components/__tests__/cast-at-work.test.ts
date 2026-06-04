import { describe, it, expect } from 'vitest'
import { castAtWork } from '~/components/cast-at-work'
import type { PulseEvent } from '~/db/pulse'
import { PostId } from '~/lib/domain'

// [LAW:behavior-not-structure] The fold's contract: one citizen → one current doing, and
// that doing is their LATEST act (the Pulse arrives newest-first). The map from pulse kind
// to doing is the behaviour under test — posting generates, judging is a vote, rescuing
// scavenges.
describe('app/components/cast-at-work.tsx - castAtWork fold', () => {
  const posted = (persona: string, ts: number): PulseEvent => ({
    kind: 'posted',
    ts,
    persona,
    postId: PostId('p1'),
    title: 'a piece',
  })
  const blessed = (persona: string, ts: number): PulseEvent => ({
    kind: 'blessed',
    ts,
    persona,
    postId: PostId('p2'),
    title: 'a piece',
    reasoning: 'holy',
  })
  const rescued = (persona: string, ts: number): PulseEvent => ({
    kind: 'rescued',
    ts,
    persona,
    postId: PostId('p3'),
  })

  it('maps each pulse kind to what the citizen is doing', () => {
    const working = castAtWork([posted('Maker', 3), blessed('Critic', 2), rescued('Picker', 1)])
    expect(working).toEqual([
      { persona: 'Maker', doing: 'generating' },
      { persona: 'Critic', doing: 'judging' },
      { persona: 'Picker', doing: 'scavenging' },
    ])
  })

  it('keeps a citizen once, at their LATEST act (events arrive newest-first)', () => {
    // newest-first: the bless is more recent than the post, so the doing is judging
    const working = castAtWork([blessed('Vivian', 5), posted('Vivian', 1)])
    expect(working).toEqual([{ persona: 'Vivian', doing: 'judging' }])
  })

  it('an idle floor yields an empty roster', () => {
    expect(castAtWork([])).toEqual([])
  })
})
