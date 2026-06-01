// [LAW:behavior-not-structure] Pins the CONTRACT of the viewer-aware wished-slop
// copy: the wisher reads second-person, a stranger reads honest third-person, and a
// stranger NEVER reads "you" or "what YOU wished". The copy is selected by the
// viewerIsModifier value (computed at the read boundary), so these two pure functions
// are where "both branches, selected by data" is machine-verifiable without a DOM.

import { describe, expect, it } from 'vitest'
import { modifierSubject, wishGapCaption } from './wish-copy'

describe('wishGapCaption', () => {
  it('addresses the wisher in the second person', () => {
    expect(wishGapCaption(true)).toBe('what you wished')
  })

  it('addresses a stranger in the third person — never "what YOU wished"', () => {
    const caption = wishGapCaption(false)
    expect(caption).toBe('what was wished')
    expect(caption).not.toContain('you')
  })
})

describe('modifierSubject', () => {
  it('names the wisher "you" when the viewer occasioned the slop', () => {
    expect(modifierSubject(true, 'anon-abc123')).toBe('you')
  })

  it('shows a stranger the human label, never "you"', () => {
    expect(modifierSubject(false, 'anon-abc123')).toBe('anon-abc123')
  })
})
