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
  BACKING_WEIGHT,
  HOT_WINDOW_MS,
  HOTNESS_DECAY_S,
  HOTNESS_REFERENCE_EPOCH,
  TOP_WINDOW_MS,
  applySortMode,
  cursorFromRow,
  defaultSortMode,
  keysetOrderBy,
  parseSortMode,
  serializeSortMode,
  sortModeLabel,
  sortModeUrlQuery,
  windowFilter,
  windowLabel,
  type SortMode,
} from '~/lib/sort-mode'

const dialect = new SQLiteSyncDialect({ casing: 'snake_case' })
// [LAW:dataflow-not-control-flow] The DISPLAY ctx applySortMode consumes: `score` is the bare "score"
// column (as getFeedPage flows it) and `affinity` is the per-post backing-lens term (the within-page
// Σ of backed-citizen votes, roll-call-47p.7). Here `affinity` is a readable `"affinity"` marker so
// the lens-blend assertions can pin where it lands in the ORDER BY. KeysetCtx (keysetOrderBy /
// cursorFilter) carries NO affinity — those consume a structural subset of this ctx.
const mockCtx = {
  score: sql`"score"`,
  affinity: sql`"affinity"`,
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

    it('all top windows emit the lens-blended effectiveScore DESC, createdAt DESC, id DESC', () => {
      for (const window of ['all', 'day', 'week'] as const) {
        const exprs = applySortMode({ mode: 'top', window }, mockCtx)
        expect(exprs).toHaveLength(3)
        // [LAW:dataflow-not-control-flow] The DISPLAY primary key is effectiveScore = score +
        // BACKING_WEIGHT * affinity (roll-call-47p.7's within-page lens). Both terms are present and
        // BACKING_WEIGHT (10) rides as a bound param. The KEYSET (keysetOrderBy, asserted below) stays
        // the bare score — the lens lives in the display re-sort, never the index seek.
        const { sql: primary, params } = dialect.sqlToQuery(exprs[0])
        expect(primary).toBe('("score" + ? * "affinity") desc')
        expect(params).toEqual([BACKING_WEIGHT])
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

    // [LAW:dataflow-not-control-flow] effectiveScore (score + BACKING_WEIGHT*affinity) is the single
    // quality axis the score-ranked modes consume. These pin where it lands: top ranks by it directly,
    // hot folds it into the hotness expression, 'new' (strict chronology) ignores it entirely. The
    // backing lens (47p.7) rides inside it via the affinity term — so every score-ranked mode carries
    // the lens through one expression, never a per-mode re-derivation.
    describe('score axis', () => {
      it('hot folds the lens-blended effectiveScore (score AND affinity) into the hotness axis', () => {
        const primary = dialect.sqlToQuery(applySortMode({ mode: 'hot' }, mockCtx)[0]).sql
        expect(primary).toContain('"score"')
        expect(primary).toContain('"affinity"') // the lens rides inside hotness, not as a separate term
        expect(primary).toContain('log(')
      })

      it('new ignores the score axis AND the lens — chronology has no quality term to rank by', () => {
        const exprs = applySortMode({ mode: 'new' }, mockCtx)
        for (const expr of exprs) {
          expect(dialect.sqlToQuery(expr).sql).not.toContain('score')
          expect(dialect.sqlToQuery(expr).sql).not.toContain('affinity')
        }
      })
    })
  })

  // [LAW:one-source-of-truth] keysetOrderBy is the SELECTION axis the cursor advances along — equal
  // to applySortMode for top/new (display IS index-seekable), divergent for hot (selection on the
  // stable created_at axis, display re-sorted by hotness in getFeedPage). These pin that divergence:
  // a top keyset seeks (score, created_at, id); new AND hot both seek (created_at, id) — hot never
  // selects by the un-indexable hotness.
  describe('keysetOrderBy', () => {
    it('top keysets (score DESC, createdAt DESC, id DESC) — equals its display order', () => {
      for (const window of ['all', 'day', 'week'] as const) {
        const exprs = keysetOrderBy({ mode: 'top', window }, mockCtx)
        expect(exprs.map((e) => dialect.sqlToQuery(e).sql)).toEqual([
          '"score" desc',
          '"created_at" desc',
          '"id" desc',
        ])
      }
    })

    it('new keysets (createdAt DESC, id DESC)', () => {
      const exprs = keysetOrderBy({ mode: 'new' }, mockCtx)
      expect(exprs.map((e) => dialect.sqlToQuery(e).sql)).toEqual(['"created_at" desc', '"id" desc'])
    })

    it('hot keysets the STABLE (createdAt DESC, id DESC) axis — NOT the un-indexable hotness', () => {
      const exprs = keysetOrderBy({ mode: 'hot' }, mockCtx)
      // The whole point: hot must NOT select by hotness (a SCAN + temp sort over the window — the
      // outage). It selects by created_at so the index SEEKS, then getFeedPage re-sorts the page.
      expect(exprs.map((e) => dialect.sqlToQuery(e).sql)).toEqual(['"created_at" desc', '"id" desc'])
      for (const e of exprs) expect(dialect.sqlToQuery(e).sql).not.toContain('log(')
    })
  })

  // [LAW:one-source-of-truth] cursorFromRow is the inverse of cursorFilter — it reads the per-mode
  // tuple off the keyset-boundary row. top carries the score boundary; new/hot carry only the
  // created_at (ms) + id boundary, so a `hot` cursor.t is the page's MIN created_at by construction.
  describe('cursorFromRow', () => {
    const row = { score: 7, createdAt: new Date(1_700_000_000_000), id: 'p-42' }

    it('top → { m:"top", s, t(ms), id }', () => {
      expect(cursorFromRow({ mode: 'top', window: 'all' }, row)).toEqual({
        m: 'top',
        s: 7,
        t: 1_700_000_000_000,
        id: 'p-42',
      })
    })

    it('new → { m:"new", t(ms), id } (no score)', () => {
      expect(cursorFromRow({ mode: 'new' }, row)).toEqual({ m: 'new', t: 1_700_000_000_000, id: 'p-42' })
    })

    it('hot → { m:"hot", t(ms), id } (no score — the created_at boundary)', () => {
      expect(cursorFromRow({ mode: 'hot' }, row)).toEqual({ m: 'hot', t: 1_700_000_000_000, id: 'p-42' })
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

    it('{ mode: "hot" } emits createdAt >= cutoff with the Hot candidate window', () => {
      // [LAW:verifiable-goals] Hot is bounded to a recent candidate window so the
      // feed rank/aggregation/temp-sort never spans every post (the free-tier-CPU
      // fix). The time-decay already sinks anything this old below the visible 50,
      // so the window changes no visible result while bounding the work.
      const expr = windowFilter({ mode: 'hot' }, mockCtx.createdAt, NOW)!
      const { sql: sqlStr, params } = dialect.sqlToQuery(expr)
      expect(sqlStr).toBe('"created_at" >= ?')
      expect(params).toEqual([NOW - HOT_WINDOW_MS])
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

  describe('sortModeUrlQuery', () => {
    it('hot → "sort=hot"', () => {
      expect(sortModeUrlQuery({ mode: 'hot' })).toBe('sort=hot')
    })

    it('new → "sort=new"', () => {
      expect(sortModeUrlQuery({ mode: 'new' })).toBe('sort=new')
    })

    it('top/all → "sort=top" (no window param for all-time)', () => {
      expect(sortModeUrlQuery({ mode: 'top', window: 'all' })).toBe('sort=top')
    })

    it('top/day → "sort=top&window=day" (two-param URL form)', () => {
      expect(sortModeUrlQuery({ mode: 'top', window: 'day' })).toBe('sort=top&window=day')
    })

    it('top/week → "sort=top&window=week" (two-param URL form)', () => {
      expect(sortModeUrlQuery({ mode: 'top', window: 'week' })).toBe('sort=top&window=week')
    })

    it('round-trips through parseSortMode for all modes', () => {
      const modes: SortMode[] = [
        { mode: 'hot' },
        { mode: 'new' },
        { mode: 'top', window: 'all' },
        { mode: 'top', window: 'day' },
        { mode: 'top', window: 'week' },
      ]
      for (const m of modes) {
        const qs = sortModeUrlQuery(m)
        const params = new URLSearchParams(qs)
        expect(parseSortMode(params.get('sort'), params.get('window'))).toEqual(m)
      }
    })
  })

  describe('windowLabel', () => {
    it('day → "Day"', () => expect(windowLabel('day')).toBe('Day'))
    it('week → "Week"', () => expect(windowLabel('week')).toBe('Week'))
    it('all → "All"', () => expect(windowLabel('all')).toBe('All'))
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
