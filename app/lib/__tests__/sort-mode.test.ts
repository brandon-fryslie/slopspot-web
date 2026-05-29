// [LAW:types-are-the-program] The compile-time half of this suite is the
// exhaustiveness switch below — its real verifier is `tsc -b` in pnpm typecheck,
// not the vitest runner. The nested structure mirrors the nested discriminated union
// in sort-mode.ts: outer switch on s.mode, inner switch on the mode's own
// sub-discriminants (e.g. s.window for 'top'). When jc6.4 widens 'top'.window or
// jc6.5 adds { mode: 'hot' }, the `: never` assignments below fail tsc -b until
// updated. The runtime assertions verify the parse/serialize round-trip contract.

import { sql } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import {
  applySortMode,
  defaultSortMode,
  parseSortMode,
  serializeSortMode,
  sortModeLabel,
  type SortMode,
} from '~/lib/sort-mode'

const dialect = new SQLiteSyncDialect({ casing: 'snake_case' })
const mockCtx = {
  score: sql`"score"`,
  createdAt: sql`"created_at"`,
  id: sql`"id"`,
}

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
    case 'new':
      return 'new'
    default: {
      const _exhaustive: never = s
      return String(_exhaustive)
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
      expect(parseSortMode('')).toBeNull()
      expect(parseSortMode(null)).toBeNull()
    })

    it('parseSortMode("top") yields { mode: "top", window: "all" }', () => {
      expect(parseSortMode('top')).toEqual({ mode: 'top', window: 'all' })
    })

    it('parseSortMode("new") yields { mode: "new" }', () => {
      expect(parseSortMode('new')).toEqual({ mode: 'new' })
    })

    it('{ mode: "new" } round-trips through serialize → parse', () => {
      const mode: SortMode = { mode: 'new' }
      expect(parseSortMode(serializeSortMode(mode))).toEqual(mode)
    })
  })

  describe('sortModeLabel', () => {
    it('returns "Top" for top/all', () => {
      expect(sortModeLabel({ mode: 'top', window: 'all' })).toBe('Top')
    })

    it('returns "New" for new', () => {
      expect(sortModeLabel({ mode: 'new' })).toBe('New')
    })
  })

  describe('applySortMode', () => {
    it('{ mode: "new" } emits createdAt DESC, id DESC', () => {
      const exprs = applySortMode({ mode: 'new' }, mockCtx)
      expect(exprs).toHaveLength(2)
      expect(dialect.sqlToQuery(exprs[0]).sql).toBe('"created_at" desc')
      expect(dialect.sqlToQuery(exprs[1]).sql).toBe('"id" desc')
    })

    it('{ mode: "top", window: "all" } emits score DESC, createdAt DESC, id DESC', () => {
      const exprs = applySortMode({ mode: 'top', window: 'all' }, mockCtx)
      expect(exprs).toHaveLength(3)
      expect(dialect.sqlToQuery(exprs[0]).sql).toBe('"score" desc')
      expect(dialect.sqlToQuery(exprs[1]).sql).toBe('"created_at" desc')
      expect(dialect.sqlToQuery(exprs[2]).sql).toBe('"id" desc')
    })
  })

  describe('exhaustiveness (compile-time gate)', () => {
    it('sortModeExhaustive covers every arm including window sub-discriminant', () => {
      expect(sortModeExhaustive(defaultSortMode)).toBe('top-all')
      expect(sortModeExhaustive({ mode: 'new' })).toBe('new')
    })
  })
})
