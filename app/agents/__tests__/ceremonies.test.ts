// [LAW:one-source-of-truth] CeremonyName is derived from CEREMONIES, so "a name in the
// type but not the list" is impossible by construction. The exhaustiveness function below
// is the inverse gate: it fails tsc -b when a new ceremony is added to CEREMONIES without
// a corresponding switch arm, forcing every consumer to stay in sync.

import { describe, it, expect } from 'vitest'
import { CEREMONIES, type CeremonyName } from '~/agents/ceremonies'

function assertAllCeremonyNames(name: CeremonyName): string {
  switch (name) {
    case 'portrait': return name
    case 'rite': return name
    case 'birth': return name
    case 'grace': return name
    case 'first-poet': return name
    default: {
      const _never: never = name
      return _never
    }
  }
}

describe('ceremony registry', () => {
  it('lists ceremonies in canonical order portrait→rite→birth→grace→first-poet', () => {
    expect(CEREMONIES.map(c => c.name)).toEqual([
      'portrait', 'rite', 'birth', 'grace', 'first-poet',
    ])
  })

  it('each ceremony has a run function', () => {
    for (const ceremony of CEREMONIES) {
      expect(typeof ceremony.run).toBe('function')
    }
  })

  it('CeremonyName exhaustiveness gate (real verifier is tsc -b)', () => {
    // Adding a ceremony without updating the switch above fails tsc -b at the never default.
    const names = CEREMONIES.map(c => assertAllCeremonyNames(c.name))
    expect(names).toEqual(['portrait', 'rite', 'birth', 'grace', 'first-poet'])
  })
})
