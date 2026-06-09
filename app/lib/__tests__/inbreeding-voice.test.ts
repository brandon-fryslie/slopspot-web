// [LAW:behavior-not-structure] The Gremlin's inbreeding aside CONTRACT (genome-p6z.6): the structural
// inbreeding signal becomes a `verdict` utterance — the EXISTING voice occasion, no new path — and the page
// renders it from the DETERMINISTIC FLOOR (no live LLM). The line must REFERENCE the cross's closeness, so
// it could only have been written about THIS inbred pair. Blind to utter()/composeVerdict decomposition.

import { describe, expect, it } from 'vitest'
import { gremlinInbreedingRemark, inbreedingReasoning } from '~/lib/inbreeding-voice'
import { AgentId, type TraitVector } from '~/lib/domain'
import type { VoicedPersonaRef } from '~/lib/voice'
import type { GeneticDistance } from '~/lib/genome-distance'

const NEUTRAL: TraitVector = { austerity: 0.5, curse: 0.5, density: 0.5, earnestness: 0.5 }
const GREMLIN: VoicedPersonaRef = {
  handle: AgentId('agent:skeptic'),
  displayName: 'The Gremlin',
  traits: NEUTRAL,
  personaPrompt: 'You are the city skeptic.',
}

describe('gremlinInbreedingRemark', () => {
  it('speaks the inbreeding verdict from the deterministic floor (no live LLM)', async () => {
    const distance: GeneticDistance = { geneMismatches: 0, traitDrift: 0 }
    const utterance = await gremlinInbreedingRemark(GREMLIN, { postId: 'p1' as never, prompt: 'a slop' }, distance)
    // The floor speaks the reasoning verbatim — a real, signed line, never a withheld silence.
    expect(utterance.kind).toBe('spoke')
    if (utterance.kind !== 'spoke') return
    // It REFERENCES the inbreeding (the closeness that earned the flag), not a generic barb.
    expect(utterance.text).toBe(inbreedingReasoning(distance))
    expect(utterance.text.toLowerCase()).toContain('inbred')
    expect(utterance.text.toLowerCase()).toContain('near-twin')
  })

  it("names HOW MANY genes apart the parents are — grounded in THIS pair", () => {
    expect(inbreedingReasoning({ geneMismatches: 0, traitDrift: 0 })).toContain('not one gene apart')
    expect(inbreedingReasoning({ geneMismatches: 1, traitDrift: 0.2 })).toContain('only 1 gene apart')
  })

  it('a caller can still inject a real transport to re-voice in register', async () => {
    const reVoice = async () => 'Cousins. Again. I hate it here.'
    const utterance = await gremlinInbreedingRemark(
      GREMLIN,
      { postId: 'p2' as never, prompt: 'a slop' },
      { geneMismatches: 1, traitDrift: 0.1 },
      reVoice,
    )
    expect(utterance).toEqual({ kind: 'spoke', text: 'Cousins. Again. I hate it here.' })
  })
})
