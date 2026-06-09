// [LAW:behavior-not-structure] Pins the Rite's election contract — and the THESIS:
// the rite is MONARCHICAL, not democratic. A sole ballot crowns the presiding
// citizen's OWN pick, even when a post the citizen never voted on is far louder with
// the rest of the city (the keystone test below — it FAILS on an all-votes ballot,
// which is the whole point). The Martyr's feud crowns the divisive intersection; the
// Miracle's acclaim is the one genuinely democratic lens. The mark is a total function
// of the lens; the liturgical week maps every UTC weekday to a rite with its ballot.

import { describe, expect, it } from 'vitest'
import {
  AgentId,
  GenomeId,
  PostId,
  ProviderId,
  type CrownMark,
  type Genome,
  type RiteLens,
  type TraitVector,
  type VoteValue,
} from '~/lib/domain'
import { NEUTRAL_TRAITS } from '~/lib/traits'
import { recipeSubjectSchema, type AspectRatio, type StyleFamily } from '~/lib/variety'
import {
  CROWN_INTENSITY_THRESHOLD,
  RITE_WINDOW_MS,
  RITES,
  ballotCitizens,
  devianceRanking,
  elect,
  markFor,
  riteForDay,
  ritePhaseClock,
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
    kind: 'voted',
    postId: PostId(opts.id),
    overallScore: opts.overallScore ?? 0,
    citizenVotes: opts.citizenVotes ?? {},
  }
}

// A genome fixture for the deviance scorer. geneticDistance reads only genes + traits, so
// the form is a free-text T00 (distinct strings = distinct forms = a form-gene mismatch);
// species/frame/medium are valid enum/registry values the caller varies to shape cohorts.
function genome(opts: {
  id: string
  species?: StyleFamily
  formText?: string
  frame?: AspectRatio
  medium?: string
  traits?: TraitVector
}): Genome {
  return {
    id: GenomeId(opts.id),
    genes: {
      species: opts.species ?? 'photoreal',
      form: recipeSubjectSchema.parse({ subjectTemplate: 'T00', slots: { freeText: opts.formText ?? 'base' } }),
      frame: opts.frame ?? '1:1',
      medium: ProviderId(opts.medium ?? 'fal-flux'),
    },
    utterance: '',
    traits: opts.traits ?? NEUTRAL_TRAITS,
    lineage: { kind: 'founder' },
  }
}

function devianceOf(out: readonly { postId: PostId; deviance: number }[], id: string): number | undefined {
  return out.find((c) => c.postId === PostId(id))?.deviance
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

describe('devianceRanking — the Heretic weighs recipe outliers within a style family', () => {
  it('a cohort of one yields no candidate — no orthodoxy to defy', () => {
    // Each genome is alone in its declared family: nothing to be a heretic against.
    const out = devianceRanking([
      genome({ id: 'a', species: 'photoreal' }),
      genome({ id: 'b', species: 'oil-painting' }),
    ])
    expect(out).toEqual([])
  })

  it('crowns the genome least like the siblings who chose its own family', () => {
    // Three photoreals: a and b are twins; c diverges in form, frame, AND medium.
    const a = genome({ id: 'a', species: 'photoreal', formText: 'x', frame: '1:1', medium: 'fal-flux' })
    const b = genome({ id: 'b', species: 'photoreal', formText: 'x', frame: '1:1', medium: 'fal-flux' })
    const c = genome({ id: 'c', species: 'photoreal', formText: 'y', frame: '16:9', medium: 'replicate-sdxl' })
    const out = devianceRanking([a, b, c])
    // mean pairwise gene-mismatch: a,b each {0 to twin, 3 to c} = 1.5; c {3, 3} = 3.
    expect(devianceOf(out, 'a')).toBe(1.5)
    expect(devianceOf(out, 'b')).toBe(1.5)
    expect(devianceOf(out, 'c')).toBe(3)
  })

  it('trait drift within an otherwise-identical cohort still registers deviance', () => {
    const a = genome({ id: 'a', species: 'photoreal', traits: NEUTRAL_TRAITS })
    const b = genome({
      id: 'b',
      species: 'photoreal',
      traits: { austerity: 1, curse: 0.5, density: 0.5, earnestness: 0.5 },
    })
    const out = devianceRanking([a, b])
    // identical genes (mismatch 0) + L1 trait drift |1 - 0.5| = 0.5 on one axis.
    expect(devianceOf(out, 'a')).toBeCloseTo(0.5)
    expect(devianceOf(out, 'b')).toBeCloseTo(0.5)
  })

  it('cohorts are family-LOCAL: a different family is never a sibling', () => {
    // Two photoreals (twins, deviance 0 between them) + one lone anime. The anime is a
    // singleton family → no candidate; the photoreals are twins → deviance 0.
    const out = devianceRanking([
      genome({ id: 'a', species: 'photoreal', formText: 'x' }),
      genome({ id: 'b', species: 'photoreal', formText: 'x' }),
      genome({ id: 'c', species: 'anime', formText: 'totally-different' }),
    ])
    expect(devianceOf(out, 'a')).toBe(0)
    expect(devianceOf(out, 'b')).toBe(0)
    expect(devianceOf(out, 'c')).toBeUndefined()
  })
})

describe('elect — deviance (the Heretic) crowns the recipe outlier', () => {
  const heretic: RiteBallot = { kind: 'deviance' }
  const deviant = (id: string, deviance: number): RiteCandidate => ({ kind: 'deviant', postId: PostId(id), deviance })

  it('crowns the greatest outlier', () => {
    expect(elect(heretic, [deviant('p-a', 1), deviant('p-b', 3)], 0)).toEqual({
      kind: 'crowned',
      postId: PostId('p-b'),
    })
  })

  it('Unmoved Day: total conformity (the most-deviant is still deviance 0) crowns nothing', () => {
    expect(elect(heretic, [deviant('p', 0)], 0)).toEqual({ kind: 'unmoved' })
  })

  it('Unmoved Day: no candidates (every family a singleton) crowns nothing', () => {
    expect(elect(heretic, [], 0)).toEqual({ kind: 'unmoved' })
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

  it('Saint→sole/Vivian/blessing, Villain→sole/Gremlin/couldn’t-bury, Heretic→deviance, Martyr→feud, Miracle→acclaim', () => {
    expect(riteForDay(0).ballot).toEqual({ kind: 'sole', citizen: 'agent:slop-purist', pole: 'blessed' })
    expect(riteForDay(1).ballot).toEqual({ kind: 'sole', citizen: 'agent:skeptic', pole: 'blessed' })
    expect(riteForDay(2).ballot).toEqual({ kind: 'deviance' })
    expect(riteForDay(4).ballot).toEqual({ kind: 'feud', blessedBy: 'agent:slop-purist', buriedBy: 'agent:skeptic' })
    expect(riteForDay(5).ballot).toEqual({ kind: 'acclaim' })
  })

  it('ballotCitizens lists the voters each ballot reads', () => {
    expect(ballotCitizens({ kind: 'sole', citizen: VIVIAN, pole: 'blessed' })).toEqual([VIVIAN])
    expect(ballotCitizens({ kind: 'feud', blessedBy: VIVIAN, buriedBy: GREMLIN })).toEqual([VIVIAN, GREMLIN])
    expect(ballotCitizens({ kind: 'acclaim' })).toEqual([])
    // The deviance ballot reads recipes, not votes — no citizen nominates.
    expect(ballotCitizens({ kind: 'deviance' })).toEqual([])
  })

  it('fails loud on a weekday outside 0..6', () => {
    expect(() => riteForDay(7)).toThrow()
  })

  it('exposes the acclaim intensity bar', () => {
    expect(CROWN_INTENSITY_THRESHOLD).toBeGreaterThan(0)
  })
})

describe('ritePhaseClock — the banner is in the held breath only in the 2–3am UTC hour', () => {
  // A fixed UTC instant builder so the test never reads the real clock.
  const at = (y: number, mo: number, d: number, h: number, mi = 0) =>
    Date.UTC(y, mo - 1, d, h, mi)

  it('stands the rest of the day — every hour but the 2am hour is the standing crown', () => {
    for (const hour of [0, 1, 3, 4, 11, 12, 17, 23]) {
      expect(ritePhaseClock(at(2026, 6, 9, hour)).kind).toBe('standing')
    }
  })

  it('deliberates across the whole 2am hour, start to last minute', () => {
    expect(ritePhaseClock(at(2026, 6, 9, 2, 0)).kind).toBe('deliberation')
    expect(ritePhaseClock(at(2026, 6, 9, 2, 59)).kind).toBe('deliberation')
  })

  it('settles at 3am sharp — the crowning instant is already the standing crown', () => {
    expect(ritePhaseClock(at(2026, 6, 9, 3, 0)).kind).toBe('standing')
  })

  it('carries the imminent ceremony window — ending at today 3am UTC, one day wide', () => {
    const phase = ritePhaseClock(at(2026, 6, 9, 2, 30))
    expect(phase.kind).toBe('deliberation')
    if (phase.kind !== 'deliberation') throw new Error('expected deliberation')
    // the window the 3am cron will weigh: [3am − 1 day, 3am), independent of the minute now.
    expect(phase.window.untilMs).toBe(at(2026, 6, 9, 3, 0))
    expect(phase.window.sinceMs).toBe(at(2026, 6, 9, 3, 0) - RITE_WINDOW_MS)
  })
})
