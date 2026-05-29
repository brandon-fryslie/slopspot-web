// [LAW:types-are-the-program] The compile-time half of this suite is the
// exhaustiveness switch below — its real verifier is `tsc -b` in pnpm typecheck,
// not the vitest runner. Adding a mode to SortMode without extending the switch
// makes the default branch reachable with a non-never value, which the compiler
// refuses. The runtime assertions verify the parse/serialize round-trip contract.

import { describe, expect, it } from 'vitest'
import {
  defaultSortMode,
  parseSortMode,
  serializeSortMode,
  sortModeLabel,
  type SortMode,
} from '~/lib/sort-mode'

// [LAW:types-are-the-program] Exhaustiveness gate — same pattern as domain-exhaustiveness.test.ts.
// Fails tsc -b when a new SortMode arm is added without extending this switch.
function sortModeExhaustive(s: SortMode): string {
  switch (s.mode) {
    case 'top':
      return 'top'
    default: {
      // Switch on s.mode; the discriminant narrows to never when all arms are handled.
      const _exhaustive: never = s.mode
      return _exhaustive
    }
  }
}

describe('app/lib/sort-mode.ts', () => {
  describe('parseSortMode / serializeSortMode round-trip', () => {
    it('defaultSortMode round-trips through serialize → parse', () => {
      const serialized = serializeSortMode(defaultSortMode)
      expect(parseSortMode(serialized)).toEqual(defaultSortMode)
    })

    it('returns null for unknown input', () => {
      expect(parseSortMode('hot')).toBeNull()
      expect(parseSortMode('new')).toBeNull()
      expect(parseSortMode('')).toBeNull()
      expect(parseSortMode(null)).toBeNull()
    })

    it('parseSortMode("top") yields { mode: "top", window: "all" }', () => {
      expect(parseSortMode('top')).toEqual({ mode: 'top', window: 'all' })
    })
  })

  describe('sortModeLabel', () => {
    it('returns "Top" for top/all', () => {
      expect(sortModeLabel({ mode: 'top', window: 'all' })).toBe('Top')
    })
  })

  describe('exhaustiveness (compile-time gate)', () => {
    it('sortModeExhaustive covers every arm', () => {
      expect(sortModeExhaustive(defaultSortMode)).toBe('top')
    })
  })
})
