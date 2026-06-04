// [LAW:behavior-not-structure] The contract of the drift scheduler's target
// selection: WHO is due for a (re)render, decided purely from each citizen's data.
// The Proprietor (declined) and the Gremlin (refused) must fall out by their data,
// not a name check; a citizen with no medium must never be selected; a fresh face
// must wait out its window. This is the type made unrepresentable-when-violated.

import { describe, expect, it } from 'vitest'
import { NEUTRAL_TRAITS } from '~/lib/traits'
import { selectPortraitTargets, PORTRAIT_DRIFT_MS } from '~/agents/portrait'
import type { Persona } from '~/agents/persona'
import { AgentId } from '~/lib/domain'

const NOW = 10 * PORTRAIT_DRIFT_MS

function persona(over: {
  agentId?: string
  role?: Persona['role']
  config: Record<string, unknown>
}): Persona {
  return {
    agentId: AgentId(over.agentId ?? 'agent:x'),
    handle: 'x',
    displayName: 'X',
    role: over.role ?? 'generator',
    personaPrompt: '',
    modelId: 'claude-haiku-4-5',
    config: over.config,
    traits: NEUTRAL_TRAITS,
  }
}

const ids = (ps: Persona[]) => ps.map((p) => p.agentId)

describe('selectPortraitTargets — who drifts this pass', () => {
  it('selects a medium-having citizen with no face yet (initial fill)', () => {
    const maker = persona({ agentId: 'agent:maker', config: { medium: 'fal-flux' } })
    expect(ids(selectPortraitTargets([maker], NOW))).toEqual(['agent:maker'])
  })

  it('excludes the Proprietor (declined) and the Gremlin (refused) by their data', () => {
    const proprietor = persona({ agentId: 'agent:prop', config: { portrait: 'declined' } })
    const gremlin = persona({ agentId: 'agent:grem', config: { portrait: 'refused' } })
    // Even a refusal that somehow also carried a medium stays excluded — character
    // wins over capability.
    const gremlinWithMedium = persona({
      agentId: 'agent:grem2',
      config: { medium: 'fal-flux', portrait: 'refused' },
    })
    expect(selectPortraitTargets([proprietor, gremlin, gremlinWithMedium], NOW)).toEqual([])
  })

  it('excludes a citizen with no medium — it cannot render in its own hand', () => {
    const critic = persona({ agentId: 'agent:critic', role: 'voter', config: {} })
    expect(selectPortraitTargets([critic], NOW)).toEqual([])
  })

  it('leaves a freshly-rendered face settled, and re-renders one past the window', () => {
    const fresh = persona({
      agentId: 'agent:fresh',
      config: { medium: 'fal-flux', portrait: { url: '/media/a', renderedAt: NOW - 1 } },
    })
    const stale = persona({
      agentId: 'agent:stale',
      config: { medium: 'fal-flux', portrait: { url: '/media/b', renderedAt: NOW - PORTRAIT_DRIFT_MS } },
    })
    expect(ids(selectPortraitTargets([fresh, stale], NOW))).toEqual(['agent:stale'])
  })
})
