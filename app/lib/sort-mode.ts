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

import { desc, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

export type SortMode = { mode: 'top'; window: 'day' | 'week' | 'all' } | { mode: 'new' } | { mode: 'hot' }

// [LAW:single-enforcer] The canonical default — Hot for lively first-time experience.
export const defaultSortMode: SortMode = { mode: 'hot' }

// [LAW:one-source-of-truth] Window durations in ms. 'hour' is Tier-2 (future epic).
export const TOP_WINDOW_MS = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
} as const

// [LAW:one-source-of-truth] Hotness constants. REFERENCE_EPOCH is project-start (Jan 1
// 2026 UTC) — stable anchor that never changes after launch. DECAY_CONSTANT is 6h (=
// cron interval): a new fire reaches parity with the previous in one decay period.
// Calibrate DECAY_CONSTANT against real vote velocity once traffic grows.
// D1 SQLite has no log10(); use log(x) * LOG10_E (= 1/ln(10)).
export const HOTNESS_REFERENCE_EPOCH = 1_735_689_600 // Jan 1 2026 00:00:00 UTC, seconds
export const HOTNESS_DECAY_S = 21_600 // 6h in seconds

// [LAW:one-source-of-truth] Hot's candidate window. Hot is time-decayed: with a 6h
// decay constant, a post 14 days old carries an age term of (14·24/6) = −56 against
// any plausible log10(score), so it ranks far below anything recent and can never
// surface in a 50-item feed. Bounding Hot's candidate set to this window is therefore
// semantically a no-op on the *visible* result while bounding the per-post vote
// aggregation and the temp sort to a recent slice instead of the whole posts table —
// the difference between O(all posts) and O(recent posts) CPU on the free-tier 10ms
// budget. 'top'/'all' stays all-time (its window param is the explicit knob); 'new'
// stays time-ordered + limited. Calibrate alongside DECAY_CONSTANT as traffic grows.
export const HOT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000
// [LAW:one-source-of-truth] 1/ln(10) ≈ 0.4342944819032518; used to convert ln→log10
// in SQLite expressions since D1 exposes only `log(x)` (natural log).
const LOG10_E = 0.4342944819032518

// [LAW:one-source-of-truth] The single weight a backed citizen's expressed opinion
// carries in the viewer's ranking — the backing lens (the-roll-call.md). `affinity`
// (supplied per post in SortCtx) is Σ of the vote values cast by citizens this viewer
// backs; this constant is how many votes-equivalent each unit of that opinion is worth
// when the feed is ranked. A backed critic's blessing (+1) lifts a post by
// BACKING_WEIGHT; a burial (−1) sinks it by the same — so you browse the city through
// your backed citizens' eyes: what they value rises, what they reject falls. It is a
// BIAS on the ranking score, never a filter (no post is ever removed), and it touches
// only the ORDER BY — the displayed score stays pure SUM(votes). Calibrate against real
// vote velocity as traffic grows, the same way DECAY_CONSTANT will be.
export const BACKING_WEIGHT = 10

// Context the caller supplies: the expressions that differ across call sites.
// `score` differs between the CTE inner query (rankScore subquery) and the outer query
// (feedIds.score projection). `affinity` is the per-post backing-lens term (0 for every
// post when the viewer backs no one). `createdAt` and `id` are always from posts but the
// caller's query context determines which binding is in scope.
// [LAW:one-source-of-truth] Callers do not hand-code ORDER BY expressions; every
// mode's expression lives in this function's switch.
type SortCtx = { score: SQLWrapper; affinity: SQLWrapper; createdAt: SQLWrapper; id: SQLWrapper }

// [LAW:dataflow-not-control-flow] The quality axis every score-ranked mode orders by:
// the post's real score, biased by the viewer's backing lens. `affinity` is a VALUE
// that is 0 for every post when the viewer backs no one (the affinity aggregate
// degrades to no rows by data), so this expression equals `score` exactly in the
// unbacked case — the normal feed, with no branch. Both 'top' and 'hot' route their
// score through here so the lens lands in one place; 'new' has no quality axis and
// ignores it (strict chronology), the same way 'new' ignores score.
function effectiveScore(ctx: SortCtx): SQL {
  return sql`(${ctx.score} + ${BACKING_WEIGHT} * ${ctx.affinity})`
}

function assertNever(discriminant: never): never {
  throw new Error(`sort-mode: unhandled discriminant ${String(discriminant)}`)
}

// [LAW:dataflow-not-control-flow] Returns the ORDER BY SQL expressions for the given
// mode. The caller spreads these into .orderBy(). Both the CTE inner query (which
// picks the visible-post ids) and the outer hydration query call this with their
// respective score expression — same code path, different data in ctx.score.
// [LAW:types-are-the-program] Nested switch: exhaustive over modes and windows.
// All top windows share the same ORDER BY; the window cutoff is a WHERE predicate
// applied via windowFilter(), which is a separate concern from ordering.
export function applySortMode(sort: SortMode, ctx: SortCtx): SQL[] {
  switch (sort.mode) {
    case 'top':
      switch (sort.window) {
        case 'all':
        case 'day':
        case 'week':
          return [desc(effectiveScore(ctx)), desc(ctx.createdAt), desc(ctx.id)]
        default:
          return assertNever(sort.window)
      }
    case 'new':
      return [desc(ctx.createdAt), desc(ctx.id)]
    case 'hot': {
      // [LAW:one-source-of-truth] Reddit hotness formula, adapted for SQLite:
      //   log10(max(|score|,1)) * sign(score) + (createdAt_s - REFERENCE_EPOCH) / DECAY_S
      // D1 has no log10; log(x) is ln(x), so log10(x) = log(x) * LOG10_E.
      // createdAt is stored as Unix ms (timestamp_ms mode) — divide by 1000 for seconds.
      // The score term is the backing-lens-biased effectiveScore: a backed citizen's
      // opinion enters the hotness exactly as extra votes would, so the lens and vote
      // velocity share one quality axis rather than competing as two ORDER BY terms.
      const s = effectiveScore(ctx)
      const hotnessExpr = sql<number>`
        ${LOG10_E} * log(max(abs(${s}), 1)) * sign(${s})
        + (${ctx.createdAt} / 1000 - ${HOTNESS_REFERENCE_EPOCH}) / ${HOTNESS_DECAY_S}`
      return [desc(hotnessExpr), desc(ctx.createdAt), desc(ctx.id)]
    }
    default:
      return assertNever(sort)
  }
}

// [LAW:dataflow-not-control-flow] Returns the WHERE predicate restricting posts to
// the given time window, or undefined for no filter. Callers pass this directly to
// .where() — Drizzle's .where(undefined) is a no-op, so the caller always calls
// .where() and the data decides whether a WHERE is emitted.
// [LAW:one-source-of-truth] TOP_WINDOW_MS is the single definition of each window's
// duration; no caller computes its own cutoff.
export function windowFilter(sort: SortMode, createdAt: SQLWrapper, now: number): SQL | undefined {
  switch (sort.mode) {
    case 'top':
      switch (sort.window) {
        case 'all': return undefined
        case 'day': return sql`${createdAt} >= ${now - TOP_WINDOW_MS.day}`
        case 'week': return sql`${createdAt} >= ${now - TOP_WINDOW_MS.week}`
        default: return assertNever(sort.window)
      }
    case 'new': return undefined
    // [LAW:one-source-of-truth] Hot's candidate window (HOT_WINDOW_MS). Unlike 'top',
    // whose window is a user-facing choice surfaced in the URL, Hot's window is an
    // internal bound: the time-decay already sinks anything this old below the visible
    // 50, so restricting the candidate set changes no visible result — it only bounds
    // the per-post aggregation + temp sort to a recent slice (the 1102-CPU fix).
    case 'hot': return sql`${createdAt} >= ${now - HOT_WINDOW_MS}`
    default: return assertNever(sort)
  }
}

// [LAW:single-enforcer] URL serialization and parsing are inverses; callers do not
// construct raw sort strings. parseSortMode returns null on unknown input — the caller
// falls back to defaultSortMode (jc6.3 wires this into the home loader).
//
// Two call patterns share one function:
//   URL path: parseSortMode(searchParams.get('sort'), searchParams.get('window'))
//     → 'top' + 'day' → { mode: 'top', window: 'day' }
//   Cookie path: parseSortMode(cookieValue)
//     → 'top/day' (slash form, serializeSortMode's output) → { mode: 'top', window: 'day' }
// Slash-form takes priority when sortParam contains '/'; two-param form applies for 'top'.
// [LAW:one-source-of-truth] No second parsing surface exists for sort values.
function parseWindow(input: string | null | undefined): 'day' | 'week' | 'all' {
  if (input === 'day') return 'day'
  if (input === 'week') return 'week'
  return 'all'
}

export function parseSortMode(sortParam: string | null, windowParam?: string | null): SortMode | null {
  if (sortParam === 'top') return { mode: 'top', window: parseWindow(windowParam) }
  if (sortParam === 'top/day') return { mode: 'top', window: 'day' }
  if (sortParam === 'top/week') return { mode: 'top', window: 'week' }
  if (sortParam === 'new') return { mode: 'new' }
  if (sortParam === 'hot') return { mode: 'hot' }
  return null
}

// [LAW:one-source-of-truth] URL query string for a sort mode. Two-param form for
// windowed top (?sort=top&window=day) so URLs match the documented query-string shape
// in parseSortMode. Cookie payload uses serializeSortMode's slash form instead;
// the two surfaces are intentionally different codecs with different semantics.
export function sortModeUrlQuery(sort: SortMode): string {
  switch (sort.mode) {
    case 'top':
      switch (sort.window) {
        case 'all': return 'sort=top'
        case 'day': return 'sort=top&window=day'
        case 'week': return 'sort=top&window=week'
        default: return assertNever(sort.window)
      }
    case 'new': return 'sort=new'
    case 'hot': return 'sort=hot'
    default: return assertNever(sort)
  }
}

// [LAW:one-source-of-truth] Slash form (e.g. 'top/day') is the cookie payload
// encoding for windowed top modes. 'top' remains the canonical form for window:all
// (back-compat and shorter URLs).
export function serializeSortMode(sort: SortMode): string {
  switch (sort.mode) {
    case 'top':
      switch (sort.window) {
        case 'all': return 'top'
        case 'day': return 'top/day'
        case 'week': return 'top/week'
        default: return assertNever(sort.window)
      }
    case 'new':
      return 'new'
    case 'hot':
      return 'hot'
    default:
      return assertNever(sort)
  }
}

// [LAW:single-enforcer] Primary selectable modes for the UI selector (jc6.6).
// Extend this array to add a future mode arm (Rising, Controversial, etc.);
// the selector renders from this list — no component edits required.
// 'top' entry uses window:'all' as the default when switching into top.
export const selectableSortModes = [
  { mode: 'hot' },
  { mode: 'new' },
  { mode: 'top', window: 'all' },
] as const satisfies readonly SortMode[]

// [LAW:single-enforcer] Selectable window variants for the top sub-selector.
export const selectableTopWindows = ['day', 'week', 'all'] as const satisfies ReadonlyArray<'day' | 'week' | 'all'>

// [LAW:single-enforcer] Human-readable labels for the UI selector (jc6.6). One place.
export function sortModeLabel(sort: SortMode): string {
  switch (sort.mode) {
    case 'top':
      switch (sort.window) {
        case 'all': return 'Top'
        case 'day': return 'Top · Day'
        case 'week': return 'Top · Week'
        default: return assertNever(sort.window)
      }
    case 'new':
      return 'New'
    case 'hot':
      return 'Hot'
    default:
      return assertNever(sort)
  }
}

// [LAW:single-enforcer] Human-readable label for a top-mode window variant.
// Kept here so all sort-selector label strings are owned by sort-mode.ts.
export function windowLabel(window: 'day' | 'week' | 'all'): string {
  switch (window) {
    case 'day': return 'Day'
    case 'week': return 'Week'
    case 'all': return 'All'
    default: return assertNever(window)
  }
}
