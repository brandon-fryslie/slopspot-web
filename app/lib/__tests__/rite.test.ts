// [LAW:behavior-not-structure] Pins the Rite's election contract: it reads the vote
// EXTREMES that already exist and crowns the strongest — or, when nothing clears the
// intensity bar, returns the Unmoved Day. Each pole reads its own extreme (a
// blessing's height, a burial's depth, a schism's lesser half); the mark is a total
// function of the lens; the liturgical week maps every UTC weekday to a rite.

import { describe, expect, it } from 'vitest'
import { PostId, type CrownMark, type RiteLens } from '~/lib/domain'
import {
  CROWN_INTENSITY_THRESHOLD,
  RITES,
  elect,
  markFor,
  riteForDay,
  type RiteCandidate,
} from '~/lib/rite'

function candidate(opts: {
  id: string
  score?: number
  blessings?: number
  burials?: number
}): RiteCandidate {
  return {
    postId: PostId(opts.id),
    score: opts.score ?? 0,
    blessings: opts.blessings ?? 0,
    burials: opts.burials ?? 0,
  }
}

describe('elect — reads vote extremes', () => {
  it('blessed pole crowns the highest score above the bar', () => {
    const result = elect(
      'blessed',
      [candidate({ id: 'p-a', score: 2 }), candidate({ id: 'p-b', score: 5 })],
      3,
    )
    expect(result).toEqual({ kind: 'crowned', postId: PostId('p-b') })
  })

  it('buried pole crowns the most-buried (lowest score) below the negative bar', () => {
    const result = elect(
      'buried',
      [candidate({ id: 'p-a', score: -1 }), candidate({ id: 'p-b', score: -6 })],
      3,
    )
    expect(result).toEqual({ kind: 'crowned', postId: PostId('p-b') })
  })

  it('divisive pole crowns the most split — bounded by the weaker camp', () => {
    const result = elect(
      'divisive',
      [
        // 5 up / 1 down looks loud but is barely divided (min 1); 4 up / 3 down is
        // the true schism (min 3). The lesser half is the measure.
        candidate({ id: 'p-loud', blessings: 5, burials: 1 }),
        candidate({ id: 'p-split', blessings: 4, burials: 3 }),
      ],
      2,
    )
    expect(result).toEqual({ kind: 'crowned', postId: PostId('p-split') })
  })

  it('Unmoved Day: nothing clears the bar → crown nothing', () => {
    const result = elect(
      'blessed',
      [candidate({ id: 'p-a', score: 2 }), candidate({ id: 'p-b', score: 1 })],
      3,
    )
    expect(result).toEqual({ kind: 'unmoved' })
  })

  it('Unmoved Day: an empty feed crowns nothing', () => {
    expect(elect('blessed', [], 3)).toEqual({ kind: 'unmoved' })
  })

  it('ties break by postId descending — same feed always crowns the same slop', () => {
    const result = elect(
      'blessed',
      [candidate({ id: 'p-a', score: 4 }), candidate({ id: 'p-b', score: 4 })],
      3,
    )
    expect(result).toEqual({ kind: 'crowned', postId: PostId('p-b') })
  })

  it('crowns exactly at the threshold (the bar is inclusive)', () => {
    expect(elect('blessed', [candidate({ id: 'p', score: 3 })], 3)).toEqual({
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

describe('the liturgical week', () => {
  it('covers all seven UTC weekdays, one lens each', () => {
    const days = RITES.map((r) => r.dayOfWeek).sort((a, b) => a - b)
    expect(days).toEqual([0, 1, 2, 3, 4, 5, 6])
    for (let d = 0; d <= 6; d++) {
      expect(riteForDay(d).dayOfWeek).toBe(d)
    }
  })

  it('Sunday saints, Monday villains, Thursday martyrs', () => {
    expect(riteForDay(0).lens).toBe('saint')
    expect(riteForDay(0).pole).toBe('blessed')
    expect(riteForDay(1).lens).toBe('villain')
    expect(riteForDay(1).pole).toBe('buried')
    expect(riteForDay(4).lens).toBe('martyr')
    expect(riteForDay(4).pole).toBe('divisive')
  })

  it('fails loud on a weekday outside 0..6', () => {
    expect(() => riteForDay(7)).toThrow()
  })

  it('exposes the intensity bar', () => {
    expect(CROWN_INTENSITY_THRESHOLD).toBeGreaterThan(0)
  })
})
