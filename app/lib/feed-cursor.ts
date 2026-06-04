// [LAW:single-enforcer] The one module that owns the feed cursor's wire format. encode/decode are
// inverses; no caller constructs or parses a raw cursor string. The token is OPAQUE to the client
// (base64url of compact JSON) so the server owns the shape and can evolve it; the client only
// echoes it back.
//
// [LAW:types-are-the-program] A cursor encodes the SORT POSITION of the last row of the previous
// page — the full tuple the ORDER BY sorts on, INCLUDING the tie-breakers, so the next page is a
// clean keyset seek (`WHERE tuple < cursor LIMIT K`) with no skips/dupes at value boundaries. The
// payload is per-mode because each SortMode sorts on a different tuple; `m` tags which, so a cursor
// can never be applied against a mode it wasn't built for (the consumer enforces `m === sort.mode`).
//
// decodeCursor returns `CursorPayload | null`: a malformed/garbage/wrong-shape cursor is a
// DISCRIMINATED ABSENCE (→ the caller serves page 1), never a throw and never a half-valid object
// downstream code must defend against. The cursor is client-supplied = a TRUST BOUNDARY, so the
// shape is validated here — ONE cheap parse per REQUEST (Zod at trust boundaries), categorically
// unlike the per-POST re-validation the feed read deleted.

import { z } from 'zod'

// The sort-position tuples, per mode. `t` is createdAt in Unix ms (the timestamp_ms column); `s` is
// the sort-key score (the backing-lens effectiveScore, which equals the stored posts.score in the
// unbacked core); `id` is the post id tie-breaker. `new`/`hot` keyset on (createdAt, id) only.
export type CursorPayload =
  | { m: 'top'; s: number; t: number; id: string }
  | { m: 'new'; t: number; id: string }
  | { m: 'hot'; t: number; id: string }

// [LAW:types-are-the-program] The trust-boundary schema: a discriminated union on `m`, so an illegal
// (mode, fields) pairing — a `new` cursor carrying an `s`, a `top` cursor missing one — is
// unrepresentable. `.strict()` rejects extra keys (a tampered/garbage token), and the whole parse
// degrades to `null`, never a partial object.
const cursorSchema = z.discriminatedUnion('m', [
  z.object({ m: z.literal('top'), s: z.number(), t: z.number().int(), id: z.string().min(1) }).strict(),
  z.object({ m: z.literal('new'), t: z.number().int(), id: z.string().min(1) }).strict(),
  z.object({ m: z.literal('hot'), t: z.number().int(), id: z.string().min(1) }).strict(),
])

// base64url (RFC 4648 §5) without padding — URL-safe so the token rides a query string untouched.
// The payload is pure ASCII (a tag, two numbers, a UUID), so btoa/atob suffice with the +/→-_ swap.
function toBase64Url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  return atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
}

export function encodeCursor(p: CursorPayload): string {
  return toBase64Url(JSON.stringify(p))
}

// Garbage in (bad base64, bad JSON, wrong shape) → null. The caller treats null as "start at page 1"
// — the honest degradation, never an error. [LAW:no-silent-fallbacks] the absence is a real value
// the caller handles, not a swallowed exception.
export function decodeCursor(raw: string): CursorPayload | null {
  let json: string
  try {
    json = fromBase64Url(raw)
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  const result = cursorSchema.safeParse(parsed)
  return result.success ? result.data : null
}
