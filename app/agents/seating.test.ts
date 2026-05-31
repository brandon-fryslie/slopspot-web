import { describe, expect, it } from 'vitest'
import { selectSeat, type Wish } from './seating'
import type { Persona } from './persona'
import { AgentId } from '~/lib/domain'

const citizen = (id: string): Persona => ({
  agentId: AgentId(id),
  handle: id,
  displayName: id,
  role: 'generator',
  personaPrompt: '',
  modelId: 'claude-haiku-4-5',
  config: {},
})

const WISH: Wish = { text: 'make me a dragon' }

describe('selectSeat', () => {
  it('maps the injected RNG deterministically across the weight bands', () => {
    // Three citizens, uniform v1 weight -> equal thirds [0,1/3) [1/3,2/3) [2/3,1).
    const candidates: [Persona, ...Persona[]] = [
      citizen('a'),
      citizen('b'),
      citizen('c'),
    ]
    expect(selectSeat(candidates, WISH, () => 0.0).agentId).toBe('a')
    expect(selectSeat(candidates, WISH, () => 0.34).agentId).toBe('b')
    expect(selectSeat(candidates, WISH, () => 0.67).agentId).toBe('c')
    expect(selectSeat(candidates, WISH, () => 0.999).agentId).toBe('c')
  })

  it('seats every citizen given the right RNG, and only ever a real candidate', () => {
    const candidates: [Persona, ...Persona[]] = [
      citizen('a'),
      citizen('b'),
      citizen('c'),
    ]
    const ids = new Set<string>(candidates.map((p) => p.agentId))
    const seated = new Set<string>()
    for (let i = 0; i < 999; i++) {
      const chosen = selectSeat(candidates, WISH, () => i / 999).agentId
      expect(ids.has(chosen)).toBe(true) // never conjures a non-candidate
      seated.add(chosen)
    }
    expect(seated).toEqual(ids) // every citizen is reachable
  })

  it('never seats a citizen outside the active pool', () => {
    // `seatCitizen` sources its pool from listPersonas('generator'); a citizen
    // not in that pool (here, one held out) is never a candidate, so the
    // weighted draw can never return it — ineligible citizens cannot be seated
    // by construction.
    const pool: [Persona, ...Persona[]] = [citizen('a'), citizen('c')]
    const heldOut = citizen('ghost')
    for (let i = 0; i < 999; i++) {
      expect(selectSeat(pool, WISH, () => i / 999).agentId).not.toBe(heldOut.agentId)
    }
  })
})
