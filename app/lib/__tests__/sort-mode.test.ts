// [LAW:types-are-the-program] The compile-time half of this suite is the
// exhaustiveness switch below — its real verifier is `tsc -b` in pnpm typecheck,
// not the vitest runner. The nested structure mirrors the nested discriminated union
// in sort-mode.ts: outer switch on s.mode, inner switch on the mode's own
// sub-discriminants (e.g. s.window for 'top'). When jc6.4 widens 'top'.window or
// jc6.2/jc6.5 add new modes, the `: never` assignments below fail tsc -b until
// updated. The runtime assertions verify the parse/serialize round-trip contract.

import { describe, expect, it } from 'vitest'
import {
  defaultSortMode,
  parseSortMode,
  serializeSortMode,
  sortModeLabel,
  type SortMode,
} from '~/lib/sort-mode'

// [LAW:types-are-the-program] Nested exhaustiveness gate. Outer switch on s.mode;
// inner switch on mode-specific sub-discriminants. Adding a mode or a window variant
// without extending these switches makes the corresponding default branch reachable
// with a non-never value, which the compiler refuses.
function sortModeExhaustive(s: SortMode): string {
  switch (s.mode) {
    case 'top':
      switch (s.window) {
        case 'all':
          return 'top-all'
        default: {
          const _exhaustive: never = s.window
          return _exhaustive
        }
      }
    default: {
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
    it('sortModeExhaustive covers every arm including window sub-discriminant', () => {
      expect(sortModeExhaustive(defaultSortMode)).toBe('top-all')
    })
  })
})
