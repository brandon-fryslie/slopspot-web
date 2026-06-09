// [LAW:behavior-not-structure] Pins standingOf's contract — when reception reads as an
// arc and when it stays steady — not its arithmetic. Standing is the meaning the roll
// call hangs on ("a hot streak ascends; work that stops landing fades"), so the cases
// are stated in that vocabulary: a surge, a collapse, a wobble, a blank slate.

import { describe, expect, it } from 'vitest'
import { standingDisplay, standingOf, type Standing } from '~/lib/standing'

describe('standingOf', () => {
  it('reads a surge above the floor as ascendant', () => {
    // From near-silence to a strong recent window — the newcomer who made a splash.
    expect(standingOf({ recent: 12, prior: 0 })).toBe('ascendant')
  })

  it('reads a collapse below the floor as fading', () => {
    // Work that used to land and stopped — the prior window dwarfs the recent one.
    expect(standingOf({ recent: 1, prior: 14 })).toBe('fading')
  })

  it('reads a small wobble as steady — drama needs more than a stray vote', () => {
    // A two-vote swing must not flip a citizen's arc; below the absolute floor it holds.
    expect(standingOf({ recent: 10, prior: 12 })).toBe('steady')
    expect(standingOf({ recent: 12, prior: 10 })).toBe('steady')
  })

  it('reads a blank slate (no reception either window) as steady', () => {
    // A newcomer before the city has responded, or a citizen no one engages — the
    // honest "no arc yet", never a manufactured one.
    expect(standingOf({ recent: 0, prior: 0 })).toBe('steady')
  })

  it('holds a heavyweight whose volume merely ripples at steady', () => {
    // At scale the proportional band, not the floor, governs: a 200→190 dip is noise.
    expect(standingOf({ recent: 190, prior: 200 })).toBe('steady')
  })

  it('reads a proportional collapse at scale as fading', () => {
    // The same heavyweight losing a quarter of its reception is a real fade.
    expect(standingOf({ recent: 140, prior: 200 })).toBe('fading')
  })

  it('reads a proportional surge at scale as ascendant', () => {
    expect(standingOf({ recent: 200, prior: 140 })).toBe('ascendant')
  })

  it('reads net-negative reception sinking further as fading', () => {
    // The Gremlin's makers: a maker whose work is increasingly buried (more negative)
    // is fading by the same rule — the currency can go below zero.
    expect(standingOf({ recent: -12, prior: -2 })).toBe('fading')
  })

  it('reads net-negative reception recovering toward zero as ascendant', () => {
    expect(standingOf({ recent: -2, prior: -12 })).toBe('ascendant')
  })

  it('is symmetric — swapping the windows inverts the arc', () => {
    expect(standingOf({ recent: 30, prior: 10 })).toBe('ascendant')
    expect(standingOf({ recent: 10, prior: 30 })).toBe('fading')
  })
})

describe('standingDisplay', () => {
  it('gives every standing a distinct mark and label', () => {
    const all: Standing[] = ['ascendant', 'steady', 'fading']
    const marks = new Set(all.map((s) => standingDisplay(s).mark))
    const labels = new Set(all.map((s) => standingDisplay(s).label))
    expect(marks.size).toBe(3)
    expect(labels.size).toBe(3)
  })

  it('labels match the standing word', () => {
    expect(standingDisplay('ascendant').label).toBe('ascendant')
    expect(standingDisplay('fading').label).toBe('fading')
  })
})
