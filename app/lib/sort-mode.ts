// [LAW:single-enforcer] One module owns SortMode — the type, its applier (ORDER BY
// expressions), its URL serialization, and its display label. All consumers (feed.ts,
// home.tsx URL parser, the future UI selector) import from here. No sort literal
// strings live in callers.
//
// [LAW:types-are-the-program] SortMode is a two-level closed discriminated union:
// `mode` is the outer discriminant; each mode arm has its own inner discriminants
// (e.g. `window` for 'top'). Adding a mode or a window variant requires extending
// the exhaustive switches in applySortMode/serializeSortMode/sortModeLabel —
// the nested assertNever gates enforce this at tsc -b time.
//
// [LAW:dataflow-not-control-flow] applySortMode runs the same way every call —
// the SortMode value picks the ORDER BY expressions; the caller spreads them into
// .orderBy(). No branch that skips .orderBy() exists.

import { desc, type SQL, type SQLWrapper } from 'drizzle-orm'

// [LAW:types-are-the-program] Single mode arm now; jc6.2 adds { mode: 'new' }, jc6.5
// adds { mode: 'hot' }. jc6.4 widens 'top' window to 'day' | 'week' | 'all' — the
// nested switch (sort.window) inside the 'top' arm then forces jc6.4 to handle the
// new windows or break tsc -b.
export type SortMode = { mode: 'top'; window: 'all' }

// [LAW:single-enforcer] The canonical default. jc6.5 flips this to { mode: 'hot' }.
export const defaultSortMode: SortMode = { mode: 'top', window: 'all' }

// Context the caller supplies: the three expressions that differ across call sites.
// `score` differs between the CTE inner query (rankScore subquery) and the outer query
// (feedIds.score projection). `createdAt` and `id` are always from posts but the
// caller's query context determines which binding is in scope.
// [LAW:one-source-of-truth] Callers do not hand-code ORDER BY expressions; every
// mode's expression lives in this function's switch.
type SortCtx = { score: SQLWrapper; createdAt: SQLWrapper; id: SQLWrapper }

function assertNever(discriminant: never): never {
  throw new Error(`sort-mode: unhandled discriminant ${String(discriminant)}`)
}

// [LAW:dataflow-not-control-flow] Returns the ORDER BY SQL expressions for the given
// mode. The caller spreads these into .orderBy(). Both the CTE inner query (which
// picks the visible-post ids) and the outer hydration query call this with their
// respective score expression — same code path, different data in ctx.score.
// [LAW:types-are-the-program] Nested switch: the outer gate on sort.mode is
// exhaustive over modes; the inner gate on sort.window is exhaustive over that
// mode's sub-variants. When jc6.4 widens 'top'.window, the inner default arm
// forces the implementor to add the new window handling.
export function applySortMode(sort: SortMode, ctx: SortCtx): SQL[] {
  switch (sort.mode) {
    case 'top':
      switch (sort.window) {
        case 'all':
          return [desc(ctx.score), desc(ctx.createdAt), desc(ctx.id)]
        default:
          return assertNever(sort.window)
      }
    default:
      return assertNever(sort.mode)
  }
}

// [LAW:single-enforcer] URL serialization and parsing are inverses; callers do not
// construct raw sort strings. parseSortMode returns null on unknown input — the caller
// falls back to defaultSortMode (jc6.3 wires this into the home loader).
export function parseSortMode(input: string | null): SortMode | null {
  if (input === 'top') return { mode: 'top', window: 'all' }
  return null
}

export function serializeSortMode(sort: SortMode): string {
  switch (sort.mode) {
    case 'top':
      switch (sort.window) {
        case 'all':
          return 'top'
        default:
          return assertNever(sort.window)
      }
    default:
      return assertNever(sort.mode)
  }
}

// [LAW:single-enforcer] Human-readable labels for the UI selector (jc6.6). One place.
export function sortModeLabel(sort: SortMode): string {
  switch (sort.mode) {
    case 'top':
      switch (sort.window) {
        case 'all':
          return 'Top'
        default:
          return assertNever(sort.window)
      }
    default:
      return assertNever(sort.mode)
  }
}
