// [LAW:behavior-not-structure] The cursor's contract: encode/decode are inverses; a malformed,
// tampered, wrong-shape, or wrong-mode-shape token decodes to NULL (page-1 degradation), never a
// throw and never a partial object. And cursorFilter is the lexicographic "strictly after" of the
// SAME tuple applySortMode orders by — proven here at the SQL-structure level; the keyset's no-skip/
// no-dupe TOTALITY under real data is the getFeedPage integration test (it needs a DB).

import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { decodeCursor, encodeCursor, type CursorPayload } from '~/lib/feed-cursor'
import { cursorFilter } from '~/lib/sort-mode'

describe('feed cursor codec', () => {
  const cases: CursorPayload[] = [
    { m: 'top', s: 42, t: 1_700_000_000_000, id: 'abc-123' },
    { m: 'top', s: -7, t: 1_700_000_000_001, id: 'def' },
    { m: 'new', t: 1_700_000_000_000, id: 'ghi' },
    { m: 'hot', t: 1_700_000_000_000, id: 'jkl' },
  ]

  it('round-trips every mode (decode ∘ encode === identity)', () => {
    for (const c of cases) {
      expect(decodeCursor(encodeCursor(c))).toEqual(c)
    }
  })

  it('produces an opaque url-safe token (no +, /, or = padding)', () => {
    const token = encodeCursor({ m: 'top', s: 1, t: 2, id: 'x'.repeat(40) })
    expect(token).not.toMatch(/[+/=]/)
  })

  it('decodes garbage to null (not a throw): bad base64, bad json', () => {
    expect(decodeCursor('!!!not base64!!!')).toBeNull()
    expect(decodeCursor(encodeCursor({ m: 'new', t: 1, id: 'a' }).slice(0, 3))).toBeNull() // truncated → bad json
    expect(decodeCursor(btoaUrl('{"m":"new"'))).toBeNull() // valid base64, broken json
  })

  it('rejects a wrong-SHAPE payload to null: mode/field mismatch and extra keys', () => {
    expect(decodeCursor(btoaUrl(JSON.stringify({ m: 'new', s: 5, t: 1, id: 'a' })))).toBeNull() // `new` must not carry `s`
    expect(decodeCursor(btoaUrl(JSON.stringify({ m: 'top', t: 1, id: 'a' })))).toBeNull() // `top` missing `s`
    expect(decodeCursor(btoaUrl(JSON.stringify({ m: 'bogus', t: 1, id: 'a' })))).toBeNull() // unknown mode
    expect(decodeCursor(btoaUrl(JSON.stringify({ m: 'new', t: 1, id: 'a', evil: 1 })))).toBeNull() // extra key (strict)
    expect(decodeCursor(btoaUrl(JSON.stringify({ m: 'new', t: 1, id: '' })))).toBeNull() // empty id
  })
})

describe('cursorFilter — the keyset is the strictly-after of the ORDER BY tuple', () => {
  const dialect = new SQLiteSyncDialect()
  const ctx = {
    score: sql`"posts"."score"`,
    createdAt: sql`"posts"."created_at"`,
    id: sql`"posts"."id"`,
  }
  const render = (c: CursorPayload) => dialect.sqlToQuery(cursorFilter(c, ctx))

  // [LAW:behavior-not-structure] The keyset is a SQLite ROW-VALUE comparison `(cols…) < (vals…)`,
  // not an OR-chain — that is what SQLite folds into an index SEEK (proven in feed-page.test.ts's
  // EXPLAIN). These pin the wire shape: the LHS is the mode's column tuple in order, the RHS its
  // cursor values in the SAME order, joined by a single `<`, with no `or`.
  it('top keysets the row-value tuple (score, created_at, id) < (s, t, id)', () => {
    const { sql: s, params } = render({ m: 'top', s: 42, t: 1700, id: 'p9' })
    expect(s).toMatch(/\(\s*"posts"\."score",\s*"posts"\."created_at",\s*"posts"\."id"\s*\)\s*<\s*\(/)
    expect(s).not.toMatch(/ or /i) // a single row-value comparison, no OR-chain
    expect(params).toEqual([42, 1700, 'p9']) // bound in tuple order: score, then created_at, then id
  })

  it('new/hot keyset the row-value tuple (created_at, id) < (t, id) — no score', () => {
    for (const m of ['new', 'hot'] as const) {
      const { sql: s, params } = render({ m, t: 1700, id: 'p9' })
      expect(s).toMatch(/\(\s*"posts"\."created_at",\s*"posts"\."id"\s*\)\s*<\s*\(/)
      expect(s).not.toContain('score')
      expect(s).not.toMatch(/ or /i)
      expect(params).toEqual([1700, 'p9'])
    }
  })
})

// Local base64url encoder for crafting raw tokens in tests (mirrors the codec's, without exporting it).
function btoaUrl(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
