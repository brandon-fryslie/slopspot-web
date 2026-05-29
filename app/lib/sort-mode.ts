// [LAW:single-enforcer] One module owns SortMode — the type, its applier (ORDER BY
// expressions), its URL serialization, and its display label. All consumers (feed.ts,
// home.tsx URL parser, the future UI selector) import from here. No sort literal
// strings live in callers.
//
// [LAW:types-are-the-program] SortMode is a closed discriminated union. Adding a mode
// is one new arm here; failing to handle it in applySortMode/serializeSortMode/
// sortModeLabel breaks tsc -b via the assertNever in the default branch.
//
// [LAW:dataflow-not-control-flow] applySortMode runs the same way every call —
// the SortMode value picks the ORDER BY expressions; the caller spreads them into
// .orderBy(). No branch that skips .orderBy() exists.

import { desc, type SQL, type SQLWrapper } from 'drizzle-orm'

// [LAW:types-are-the-program] Single arm now; jc6.2 adds { mode: 'new' }, jc6.4
// widens 'top' window to 'day' | 'week' | 'all', jc6.5 adds { mode: 'hot' }.
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

function assertNever(mode: never): never {
  throw new Error(`sort-mode: unhandled SortMode mode ${String(mode)}`)
}

// [LAW:dataflow-not-control-flow] Returns the ORDER BY SQL expressions for the given
// mode. The caller spreads these into .orderBy(). Both the CTE inner query (which
// picks the visible-post ids) and the outer hydration query call this with their
// respective score expression — same code path, different data in ctx.score.
export function applySortMode(sort: SortMode, ctx: SortCtx): SQL[] {
  switch (sort.mode) {
    case 'top':
      return [desc(ctx.score), desc(ctx.createdAt), desc(ctx.id)]
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
      return 'top'
    default:
      return assertNever(sort.mode)
  }
}

// [LAW:single-enforcer] Human-readable labels for the UI selector (jc6.6). One place.
export function sortModeLabel(sort: SortMode): string {
  switch (sort.mode) {
    case 'top':
      return 'Top'
    default:
      return assertNever(sort.mode)
  }
}
