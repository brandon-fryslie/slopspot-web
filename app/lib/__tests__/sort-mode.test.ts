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
  HOTNESS_DECAY_S,
  HOTNESS_REFERENCE_EPOCH,
  TOP_WINDOW_MS,
  applySortMode,
  defaultSortMode,
  parseSortMode,
  serializeSortMode,
  sortModeLabel,
  windowFilter,
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
        case 'day':
          return 'top-day'
        case 'week':
          return 'top-week'
        default: {
          const _exhaustive: never = s.window
          return _exhaustive
        }
      }
    case 'new':
      return 'new'
    case 'hot':
      return 'hot'
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
      expect(parseSortMode('')).toBeNull()
      expect(parseSortMode(null)).toBeNull()
      expect(parseSortMode('rising')).toBeNull()
    })

    it('parseSortMode("top") yields { mode: "top", window: "all" }', () => {
      expect(parseSortMode('top')).toEqual({ mode: 'top', window: 'all' })
    })

    it('parseSortMode("top", "day") yields { mode: "top", window: "day" }', () => {
      expect(parseSortMode('top', 'day')).toEqual({ mode: 'top', window: 'day' })
    })

    it('parseSortMode("top", "week") yields { mode: "top", window: "week" }', () => {
      expect(parseSortMode('top', 'week')).toEqual({ mode: 'top', window: 'week' })
    })

    it('parseSortMode("top", "all") yields { mode: "top", window: "all" }', () => {
      expect(parseSortMode('top', 'all')).toEqual({ mode: 'top', window: 'all' })
    })

    it('parseSortMode("top", null) defaults window to "all"', () => {
      expect(parseSortMode('top', null)).toEqual({ mode: 'top', window: 'all' })
    })

    it('parseSortMode("top", unknown-value) defaults window to "all"', () => {
      expect(parseSortMode('top', 'garbage')).toEqual({ mode: 'top', window: 'all' })
    })

    it('parseSortMode("top/day") yields { mode: "top", window: "day" } (cookie form)', () => {
      expect(parseSortMode('top/day')).toEqual({ mode: 'top', window: 'day' })
    })

    it('parseSortMode("top/week") yields { mode: "top", window: "week" } (cookie form)', () => {
      expect(parseSortMode('top/week')).toEqual({ mode: 'top', window: 'week' })
    })

    it('parseSortMode("new") yields { mode: "new" }', () => {
      expect(parseSortMode('new')).toEqual({ mode: 'new' })
    })

    it('{ mode: "new" } round-trips through serialize → parse', () => {
      const mode: SortMode = { mode: 'new' }
      expect(parseSortMode(serializeSortMode(mode))).toEqual(mode)
    })

    it('{ mode: "top", window: "day" } round-trips through serialize → parse', () => {
      const mode: SortMode = { mode: 'top', window: 'day' }
      expect(parseSortMode(serializeSortMode(mode))).toEqual(mode)
    })

    it('{ mode: "top", window: "week" } round-trips through serialize → parse', () => {
      const mode: SortMode = { mode: 'top', window: 'week' }
      expect(parseSortMode(serializeSortMode(mode))).toEqual(mode)
    })

    it('serializeSortMode top/day → "top/day", top/week → "top/week"', () => {
      expect(serializeSortMode({ mode: 'top', window: 'day' })).toBe('top/day')
      expect(serializeSortMode({ mode: 'top', window: 'week' })).toBe('top/week')
    })

    it('parseSortMode("hot") yields { mode: "hot" }', () => {
      expect(parseSortMode('hot')).toEqual({ mode: 'hot' })
    })

    it('{ mode: "hot" } round-trips through serialize → parse', () => {
      const mode: SortMode = { mode: 'hot' }
      expect(parseSortMode(serializeSortMode(mode))).toEqual(mode)
    })

    it('serializeSortMode({ mode: "hot" }) → "hot"', () => {
      expect(serializeSortMode({ mode: 'hot' })).toBe('hot')
    })
  })

  describe('sortModeLabel', () => {
    it('returns "Top" for top/all', () => {
      expect(sortModeLabel({ mode: 'top', window: 'all' })).toBe('Top')
    })

    it('returns "Top · Day" for top/day', () => {
      expect(sortModeLabel({ mode: 'top', window: 'day' })).toBe('Top · Day')
    })

    it('returns "Top · Week" for top/week', () => {
      expect(sortModeLabel({ mode: 'top', window: 'week' })).toBe('Top · Week')
    })

    it('returns "New" for new', () => {
      expect(sortModeLabel({ mode: 'new' })).toBe('New')
    })

    it('returns "Hot" for hot', () => {
      expect(sortModeLabel({ mode: 'hot' })).toBe('Hot')
    })
  })

  describe('applySortMode', () => {
    it('{ mode: "new" } emits createdAt DESC, id DESC', () => {
      const exprs = applySortMode({ mode: 'new' }, mockCtx)
      expect(exprs).toHaveLength(2)
      expect(dialect.sqlToQuery(exprs[0]).sql).toBe('"created_at" desc')
      expect(dialect.sqlToQuery(exprs[1]).sql).toBe('"id" desc')
    })

    it('all top windows emit score DESC, createdAt DESC, id DESC (window is a WHERE concern)', () => {
      for (const window of ['all', 'day', 'week'] as const) {
        const exprs = applySortMode({ mode: 'top', window }, mockCtx)
        expect(exprs).toHaveLength(3)
        expect(dialect.sqlToQuery(exprs[0]).sql).toBe('"score" desc')
        expect(dialect.sqlToQuery(exprs[1]).sql).toBe('"created_at" desc')
        expect(dialect.sqlToQuery(exprs[2]).sql).toBe('"id" desc')
      }
    })

    it('{ mode: "hot" } emits hotness DESC, createdAt DESC, id DESC (3 exprs)', () => {
      const exprs = applySortMode({ mode: 'hot' }, mockCtx)
      expect(exprs).toHaveLength(3)
      // Secondary and tertiary tiebreakers stay the same as other modes.
      expect(dialect.sqlToQuery(exprs[1]).sql).toBe('"created_at" desc')
      expect(dialect.sqlToQuery(exprs[2]).sql).toBe('"id" desc')
      // Primary: the hotness expression embeds the constants from sort-mode.ts.
      const primary = dialect.sqlToQuery(exprs[0]).sql
      expect(primary).toContain('log(')
      expect(primary).toContain('sign(')
    })

    // Hotness-ordering unit test: three posts with hand-calculated hotness values.
    //
    // Formula: log10(max(|score|,1)) * sign(score) + (createdAt_s - REFERENCE_EPOCH) / DECAY_S
    // where log10(x) = log(x) * LOG10_E in SQLite (ln-based log).
    //
    // Post A: score=1,   createdAt_s = REFERENCE_EPOCH + 4*DECAY_S  → 0 + 4 = 4.0
    // Post B: score=100, createdAt_s = REFERENCE_EPOCH              → 2 + 0 = 2.0
    // Post C: score=10,  createdAt_s = REFERENCE_EPOCH              → 1 + 0 = 1.0
    // Expected order: A (4.0) > B (2.0) > C (1.0)
    it('hotness ordering: age can outrank score per formula', () => {
      const LOG10_E = 0.4342944819032518
      const hotness = (score: number, createdAtS: number): number => {
        const logPart = LOG10_E * Math.log(Math.max(Math.abs(score), 1)) * Math.sign(score)
        const agePart = (createdAtS - HOTNESS_REFERENCE_EPOCH) / HOTNESS_DECAY_S
        return logPart + agePart
      }

      const postA = hotness(1, HOTNESS_REFERENCE_EPOCH + 4 * HOTNESS_DECAY_S) // 0 + 4 = 4.0
      const postB = hotness(100, HOTNESS_REFERENCE_EPOCH)                      // 2 + 0 = 2.0
      const postC = hotness(10, HOTNESS_REFERENCE_EPOCH)                       // 1 + 0 = 1.0

      expect(postA).toBeCloseTo(4.0, 5)
      expect(postB).toBeCloseTo(2.0, 5)
      expect(postC).toBeCloseTo(1.0, 5)
      expect(postA).toBeGreaterThan(postB)
      expect(postB).toBeGreaterThan(postC)
    })
  })

  describe('windowFilter', () => {
    const NOW = 1_000_000_000_000

    it('returns undefined for { mode: "top", window: "all" }', () => {
      expect(windowFilter({ mode: 'top', window: 'all' }, mockCtx.createdAt, NOW)).toBeUndefined()
    })

    it('returns undefined for { mode: "new" }', () => {
      expect(windowFilter({ mode: 'new' }, mockCtx.createdAt, NOW)).toBeUndefined()
    })

    it('returns undefined for { mode: "hot" } — no time window filter', () => {
      expect(windowFilter({ mode: 'hot' }, mockCtx.createdAt, NOW)).toBeUndefined()
    })

    it('{ mode: "top", window: "day" } emits createdAt >= cutoff with day offset', () => {
      const expr = windowFilter({ mode: 'top', window: 'day' }, mockCtx.createdAt, NOW)!
      const { sql: sqlStr, params } = dialect.sqlToQuery(expr)
      expect(sqlStr).toBe('"created_at" >= ?')
      expect(params).toEqual([NOW - TOP_WINDOW_MS.day])
    })

    it('{ mode: "top", window: "week" } emits createdAt >= cutoff with week offset', () => {
      const expr = windowFilter({ mode: 'top', window: 'week' }, mockCtx.createdAt, NOW)!
      const { sql: sqlStr, params } = dialect.sqlToQuery(expr)
      expect(sqlStr).toBe('"created_at" >= ?')
      expect(params).toEqual([NOW - TOP_WINDOW_MS.week])
    })
  })

  describe('exhaustiveness (compile-time gate)', () => {
    it('sortModeExhaustive covers every arm including window sub-discriminant', () => {
      expect(sortModeExhaustive({ mode: 'top', window: 'all' })).toBe('top-all')
      expect(sortModeExhaustive({ mode: 'top', window: 'day' })).toBe('top-day')
      expect(sortModeExhaustive({ mode: 'top', window: 'week' })).toBe('top-week')
      expect(sortModeExhaustive({ mode: 'new' })).toBe('new')
      expect(sortModeExhaustive({ mode: 'hot' })).toBe('hot')
    })

    it('defaultSortMode is { mode: "hot" }', () => {
      expect(defaultSortMode).toEqual({ mode: 'hot' })
    })
  })
})
