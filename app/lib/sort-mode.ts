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
import type { CursorPayload } from '~/lib/feed-cursor'

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

// [LAW:dataflow-not-control-flow] Context the caller supplies. `score` is THE sort-score
// EXPRESSION the mode ranks by — variance lives in WHICH expression the caller flows through this
// field, never in a branch inside applySortMode/keysetOrderBy/cursorFilter. getFeedPage sets it to
// the BARE `posts.score` column, so the `(score, created_at, id)` index SEEKS the keyset instead of
// SCANning a computed expression. [LAW:one-source-of-truth] applySortMode's ORDER BY,
// keysetOrderBy's selection axis, and cursorFilter's keyset predicate all consume THIS one field,
// so display order, selection order, and the cursor WHERE cannot disagree (disagreement is the
// skip/dupe bug).
//
// The viewer-specific backing lens (the-roll-call.md) — which would flow a weighted
// `posts.score + W*affinity` expression through this same field for backed viewers — is the
// flagged follow-up slopspot-roll-call-47p.7 (within-page affinity re-rank, blocked on operator
// sign-off). It is deliberately NOT in this core: that expression is not index-seekable, so it
// cannot serve the keyset the same way the bare column does.
type SortCtx = { score: SQLWrapper; createdAt: SQLWrapper; id: SQLWrapper }

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
          return [desc(ctx.score), desc(ctx.createdAt), desc(ctx.id)]
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
      // The score term is ctx.score — the bare posts.score column getFeedPage flows through. This is
      // hot's DISPLAY order, applied over an already-selected page (getFeedPage selects the page by
      // keysetOrderBy on the stable created_at axis, then re-sorts that bounded page by this hotness
      // — the §4.2 within-slab re-sort). Hotness is not index-seekable, so it ranks the page, never
      // selects it.
      const s = ctx.score
      const hotnessExpr = sql<number>`
        ${LOG10_E} * log(max(abs(${s}), 1)) * sign(${s})
        + (${ctx.createdAt} / 1000 - ${HOTNESS_REFERENCE_EPOCH}) / ${HOTNESS_DECAY_S}`
      return [desc(hotnessExpr), desc(ctx.createdAt), desc(ctx.id)]
    }
    default:
      return assertNever(sort)
  }
}

// [LAW:one-source-of-truth] The keyset predicate: the lexicographic "strictly after" of the SAME
// tuple keysetOrderBy selects by, consuming the SAME ctx.score, so the ORDER BY and the cursor WHERE
// cannot disagree (a disagreement IS the skip/dupe bug). For `top` the key is (ctx.score, createdAt,
// id); for `new`/`hot` it is (createdAt, id) — hot deliberately keysets the STABLE created_at axis
// (the §4 slab approximation), its hotness re-sort happening within the page in getFeedPage, NOT here.
//
// [LAW:types-are-the-program] Expressed as a SQLite ROW-VALUE comparison `(a, b, c) < (x, y, z)`, NOT
// the equivalent `(a<x) OR (a=x AND b<y) OR …` OR-chain. MEASURED (EXPLAIN, feed-page.test.ts): the
// OR-chain forces SQLite to SCAN+filter the index — O(depth) — because it cannot fold the disjunction
// into a seek range; the row-value form IS folded into `SEARCH … USING COVERING INDEX (…)<(?,?,?)`,
// an O(K) seek to the cursor position. Same lexicographic semantics (all-DESC ⇒ strictly-after ⇒ the
// whole tuple `<` the cursor tuple), fewer terms, and the difference between O(depth) and O(K).
//
// `cursor.m` IS the discriminator — the caller has already enforced `cursor.m === sort.mode` (a
// mismatch decodes to page 1, no cursor, no call here), so this reads the cursor's own variant. The
// window cutoff is a SEPARATE WHERE (windowFilter), ANDed in by the caller. [LAW:types-are-the-program]
// exhaustive over the cursor union.
export function cursorFilter(cursor: CursorPayload, ctx: SortCtx): SQL {
  switch (cursor.m) {
    case 'top':
      return sql`(${ctx.score}, ${ctx.createdAt}, ${ctx.id}) < (${cursor.s}, ${cursor.t}, ${cursor.id})`
    case 'new':
    case 'hot':
      return sql`(${ctx.createdAt}, ${ctx.id}) < (${cursor.t}, ${cursor.id})`
    default:
      return assertNever(cursor)
  }
}

// [LAW:one-source-of-truth] The candidate-SELECTION order — the axis the cursor advances along,
// the lexicographic order whose "strictly after" cursorFilter is. For `top`/`new` it is identical
// to applySortMode (the display order IS index-seekable), so the selected page needs no re-sort.
// For `hot` it DIVERGES: hotness is not index-seekable, so hot SELECTS along the stable created_at
// axis (so the (created_at) index SEEKS the keyset) and getFeedPage re-sorts the bounded page by
// applySortMode's hotness afterward. That divergence is the entire reason this function exists
// apart from applySortMode. Same DESC directions as cursorFilter so ORDER BY and WHERE agree by
// construction. [LAW:types-are-the-program] exhaustive over modes (+ top windows).
export function keysetOrderBy(sort: SortMode, ctx: SortCtx): SQL[] {
  switch (sort.mode) {
    case 'top':
      switch (sort.window) {
        case 'all':
        case 'day':
        case 'week':
          return [desc(ctx.score), desc(ctx.createdAt), desc(ctx.id)]
        default:
          return assertNever(sort.window)
      }
    case 'new':
    case 'hot':
      return [desc(ctx.createdAt), desc(ctx.id)]
    default:
      return assertNever(sort)
  }
}

// [LAW:one-source-of-truth] The cursor BUILDER — the inverse of cursorFilter, reading the same
// per-mode tuple off the keyset-boundary row (the last row in keysetOrderBy order, i.e. the lowest
// position the page reached). `top` carries the score boundary; `new`/`hot` carry only the
// created_at boundary (`hot`'s cursor.t is therefore the MIN created_at of the selected page, by
// construction of keysetOrderBy). createdAt is stored ms (timestamp_ms), surfaced as a Date — .getTime()
// returns the ms the cursor compares against. [LAW:types-are-the-program] the returned variant's `m`
// matches `sort.mode`, so a cursor can only ever be built for the mode that produced it.
export function cursorFromRow(
  sort: SortMode,
  row: { score: number; createdAt: Date; id: string },
): CursorPayload {
  switch (sort.mode) {
    case 'top':
      return { m: 'top', s: row.score, t: row.createdAt.getTime(), id: row.id }
    case 'new':
      return { m: 'new', t: row.createdAt.getTime(), id: row.id }
    case 'hot':
      return { m: 'hot', t: row.createdAt.getTime(), id: row.id }
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
