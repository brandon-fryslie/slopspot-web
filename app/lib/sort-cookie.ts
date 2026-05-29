// [LAW:single-enforcer] The one place sort-preference cookie logic lives.
// readSortCookie and serializeSortCookie are the only entry points for reading
// or writing the sort preference cookie. The payload wire format is identical
// to the URL param wire format — both flow through parseSortMode /
// serializeSortMode. [LAW:one-source-of-truth] No second encoding exists.

import {
  parseSortMode,
  serializeSortMode,
  type SortMode,
} from '~/lib/sort-mode'

const COOKIE_NAME = 'slopspot_sort'
const COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60

// [LAW:types-are-the-program] The cookie is a trust boundary: whatever the
// client sends is an arbitrary string. parseSortMode returns null on unknown
// input, collapsing both "absent" and "unrecognized value" into the same null
// arm. The caller falls through to the next source in the resolution fold
// (URL param ?? cookie ?? defaultSortMode).
export function readSortCookie(request: Request): SortMode | null {
  const header = request.headers.get('Cookie')
  if (header === null) return null
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(`${COOKIE_NAME}=`)) {
      return parseSortMode(trimmed.slice(COOKIE_NAME.length + 1))
    }
  }
  return null
}

// Returns the raw cookie string value (before parseSortMode) so the home
// loader can compare serialized form to detect changes without re-serializing.
export function readSortCookieRaw(request: Request): string | null {
  const header = request.headers.get('Cookie')
  if (header === null) return null
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(`${COOKIE_NAME}=`)) {
      return trimmed.slice(COOKIE_NAME.length + 1)
    }
  }
  return null
}

// [LAW:one-source-of-truth] Payload is serializeSortMode output — the same
// string the URL param uses. Round-tripping through parseSortMode is free.
export function serializeSortCookie(sort: SortMode, secure: boolean): string {
  const parts = [
    `${COOKIE_NAME}=${serializeSortMode(sort)}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE_S}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}
