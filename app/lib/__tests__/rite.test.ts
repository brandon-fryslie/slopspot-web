// [LAW:behavior-not-structure] Pins the Rite's election contract — and the THESIS:
// the rite is MONARCHICAL, not democratic. A sole ballot crowns the presiding
// citizen's OWN pick, even when a post the citizen never voted on is far louder with
// the rest of the city (the keystone test below — it FAILS on an all-votes ballot,
// which is the whole point). The Martyr's feud crowns the divisive intersection; the
// Miracle's acclaim is the one genuinely democratic lens. The mark is a total function
// of the lens; the liturgical week maps every UTC weekday to a rite with its ballot.

import { describe, expect, it } from 'vitest'
import { AgentId, PostId, type CrownMark, type RiteLens, type VoteValue } from '~/lib/domain'
import {
  CROWN_INTENSITY_THRESHOLD,
  RITES,
  ballotCitizens,
  elect,
  markFor,
  riteForDay,
  type RiteBallot,
  type RiteCandidate,
} from '~/lib/rite'

const VIVIAN = AgentId('agent:vivian')
const GREMLIN = AgentId('agent:gremlin')

function candidate(opts: {
  id: string
  overallScore?: number
  citizenVotes?: Record<string, VoteValue>
}): RiteCandidate {
  return {
    postId: PostId(opts.id),
    overallScore: opts.overallScore ?? 0,
    citizenVotes: opts.citizenVotes ?? {},
  }
}

describe('elect — the monarchical ballot (sole)', () => {
  const saint: RiteBallot = { kind: 'sole', citizen: VIVIAN, pole: 'blessed' }

  it('KEYSTONE: crowns the presiding citizen’s pick over a louder post she never voted on', () => {
    // A: Vivian blessed it, but the rest of the city is quiet (overall +1).
    const a = candidate({ id: 'p-a', overallScore: 1, citizenVotes: { 'agent:vivian': 1 } })
    // B: a roaring democratic majority — but Vivian never voted on it.
    const b = candidate({ id: 'p-b', overallScore: 99, citizenVotes: {} })
    // The Saint is A. (On an all-votes ballot B would win — that is the bug this guards.)
    expect(elect(saint, [a, b], 3)).toEqual({ kind: 'crowned', postId: PostId('p-a') })
  })

  it('among the citizen’s own blessings, crowns the one the city most affirms', () => {
    const a = candidate({ id: 'p-a', overallScore: 2, citizenVotes: { 'agent:vivian': 1 } })
    const b = candidate({ id: 'p-b', overallScore: 7, citizenVotes: { 'agent:vivian': 1 } })
    expect(elect(saint, [a, b], 3)).toEqual({ kind: 'crowned', postId: PostId('p-b') })
  })

  it('Unmoved Day: the presiding citizen blessed nothing → crown nothing', () => {
    // The city voted, but Vivian did not bless any of it.
    const a = candidate({ id: 'p-a', overallScore: 9, citizenVotes: { 'agent:someone-else': 1 } })
    expect(elect(saint, [a], 3)).toEqual({ kind: 'unmoved' })
  })

  it('a buried-pole sole ballot crowns the citizen’s downvote', () => {
    const ballot: RiteBallot = { kind: 'sole', citizen: GREMLIN, pole: 'buried' }
    const a = candidate({ id: 'p-a', overallScore: 0, citizenVotes: { 'agent:gremlin': -1 } })
    const b = candidate({ id: 'p-b', overallScore: 5, citizenVotes: { 'agent:gremlin': 1 } })
    expect(elect(ballot, [a, b], 3)).toEqual({ kind: 'crowned', postId: PostId('p-a') })
  })
})

describe('elect — the feud (Martyr) crowns the divisive intersection', () => {
  const martyr: RiteBallot = { kind: 'feud', blessedBy: VIVIAN, buriedBy: GREMLIN }

  it('crowns the slop Vivian blessed AND the Gremlin buried — the same picture', () => {
    const split = candidate({
      id: 'p-split',
      overallScore: 0,
      citizenVotes: { 'agent:vivian': 1, 'agent:gremlin': -1 },
    })
    // Vivian blessed it but the Gremlin did not bury it → not divisive, not nominated.
    const oneSided = candidate({ id: 'p-one', overallScore: 9, citizenVotes: { 'agent:vivian': 1 } })
    expect(elect(martyr, [split, oneSided], 3)).toEqual({ kind: 'crowned', postId: PostId('p-split') })
  })

  it('Unmoved Day: no slop split the two citizens → crown nothing', () => {
    const a = candidate({ id: 'p-a', citizenVotes: { 'agent:vivian': 1, 'agent:gremlin': 1 } })
    expect(elect(martyr, [a], 3)).toEqual({ kind: 'unmoved' })
  })
})

describe('elect — acclaim (Miracle) is the one democratic lens', () => {
  const acclaim: RiteBallot = { kind: 'acclaim' }

  it('crowns the highest overall score once it clears the intensity bar', () => {
    const a = candidate({ id: 'p-a', overallScore: 2 })
    const b = candidate({ id: 'p-b', overallScore: 5 })
    expect(elect(acclaim, [a, b], 3)).toEqual({ kind: 'crowned', postId: PostId('p-b') })
  })

  it('Unmoved Day: nothing clears the bar → crown nothing (never the mid)', () => {
    expect(elect(acclaim, [candidate({ id: 'p-a', overallScore: 2 })], 3)).toEqual({ kind: 'unmoved' })
  })

  it('Unmoved Day: an empty feed crowns nothing', () => {
    expect(elect(acclaim, [], 3)).toEqual({ kind: 'unmoved' })
  })

  it('crowns exactly at the threshold (the bar is inclusive)', () => {
    expect(elect(acclaim, [candidate({ id: 'p', overallScore: 3 })], 3)).toEqual({
      kind: 'crowned',
      postId: PostId('p'),
    })
  })
})

describe('markFor — the eternal mark derives from the lens', () => {
  it('maps every lens to its tone', () => {
    const expected: Record<RiteLens, CrownMark> = {
      saint: 'gold',
      villain: 'magenta',
      heretic: 'magenta',
      relic: 'bronze',
      martyr: 'split',
      miracle: 'bone',
      confession: 'bone',
    }
    for (const [lens, mark] of Object.entries(expected)) {
      expect(markFor(lens as RiteLens)).toBe(mark)
    }
  })
})

describe('the liturgical week maps each lens to the doc’s ballot', () => {
  it('covers all seven UTC weekdays, one lens each', () => {
    const days = RITES.map((r) => r.dayOfWeek).sort((a, b) => a - b)
    expect(days).toEqual([0, 1, 2, 3, 4, 5, 6])
    for (let d = 0; d <= 6; d++) {
      expect(riteForDay(d).dayOfWeek).toBe(d)
    }
  })

  it('Saint→sole/Vivian/blessing, Villain→sole/Gremlin/couldn’t-bury, Martyr→feud, Miracle→acclaim', () => {
    expect(riteForDay(0).ballot).toEqual({ kind: 'sole', citizen: 'agent:slop-purist', pole: 'blessed' })
    expect(riteForDay(1).ballot).toEqual({ kind: 'sole', citizen: 'agent:skeptic', pole: 'blessed' })
    expect(riteForDay(4).ballot).toEqual({ kind: 'feud', blessedBy: 'agent:slop-purist', buriedBy: 'agent:skeptic' })
    expect(riteForDay(5).ballot).toEqual({ kind: 'acclaim' })
  })

  it('ballotCitizens lists the voters each ballot reads', () => {
    expect(ballotCitizens({ kind: 'sole', citizen: VIVIAN, pole: 'blessed' })).toEqual([VIVIAN])
    expect(ballotCitizens({ kind: 'feud', blessedBy: VIVIAN, buriedBy: GREMLIN })).toEqual([VIVIAN, GREMLIN])
    expect(ballotCitizens({ kind: 'acclaim' })).toEqual([])
  })

  it('fails loud on a weekday outside 0..6', () => {
    expect(() => riteForDay(7)).toThrow()
  })

  it('exposes the acclaim intensity bar', () => {
    expect(CROWN_INTENSITY_THRESHOLD).toBeGreaterThan(0)
  })
})
