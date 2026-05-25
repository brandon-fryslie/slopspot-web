// [LAW:single-enforcer] The one place voter identity comes into existence and
// the one place it is read from a Request. Every route that needs a voter id —
// the vote endpoint, the home loader (to project FeedItem.myVote) — funnels
// through `resolveVoter`, so the cookie name, attributes, and minting logic
// live exactly once and cannot drift per-callsite.
//
// [LAW:types-are-the-program] The return shape is one discriminator: a present
// `setCookieHeader` (non-null) means "we just minted, set this on the response";
// `null` means "the cookie was already there, no header needed." Callers do not
// need to know which case fired — they unconditionally forward the header when
// non-null. The variability lives in the value, not in two return shapes.
//
// Voter identity v1 is an opaque anonymous UUID per browser. Real auth is a
// later epic; the votes table's voter_id is intentionally an opaque TEXT with
// no FK so user/agent ids can move into the same column later.

const COOKIE_NAME = 'slopspot_voter'
// One year. Long enough that vote idempotency survives normal cookie clears
// from things other than user-initiated. If a viewer clears cookies they get
// a fresh identity — votes from the old id remain, the new id starts at zero.
const COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60

// [LAW:types-are-the-program] The cookie is the trust boundary; whatever the
// client sends arrives as an arbitrary string. The only shape `crypto.randomUUID`
// emits is RFC-4122 hex-dash UUIDs, so that IS the legitimate shape — anything
// else is forged or stale and must be rejected at parse, not papered over later
// (e.g. with an empty-string sentinel collision in the feed reader's LEFT JOIN).
// [LAW:single-enforcer] one validator at one boundary; downstream code can trust
// every voter id is a UUID by construction.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type VoterResolution = {
  voterId: string
  setCookieHeader: string | null
}

// [LAW:types-are-the-program] The return discriminator (string | undefined)
// absorbs both legitimate "no cookie" and "cookie present but malformed" into
// the same arm. Downstream code does not need to know which fired — it just
// gets a valid UUID or nothing. An attacker setting `slopspot_voter=` cannot
// inject the empty-string sentinel that feed.ts uses for its LEFT JOIN, nor
// can a stale/forged value be propagated into a stored vote row.
function readCookie(request: Request): string | undefined {
  const header = request.headers.get('Cookie')
  if (header === null) return undefined
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(`${COOKIE_NAME}=`)) {
      const value = trimmed.slice(COOKIE_NAME.length + 1)
      return UUID_RE.test(value) ? value : undefined
    }
  }
  return undefined
}

function buildSetCookie(value: string, secure: boolean): string {
  // Secure is conditional on URL protocol: vite dev serves HTTP, which would
  // reject a Secure cookie and break local testing entirely. Workers prod is
  // always HTTPS, so the production path always emits Secure.
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE_S}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function resolveVoter(request: Request): VoterResolution {
  const existing = readCookie(request)
  const voterId = existing ?? crypto.randomUUID()
  const setCookieHeader = existing
    ? null
    : buildSetCookie(voterId, new URL(request.url).protocol === 'https:')
  return { voterId, setCookieHeader }
}

// [LAW:single-enforcer] The read-only sibling: feed loaders need to project
// myVote when a cookie already exists, but should NOT mint one (a GET that
// commits identity surprises the viewer). Both reads and the read-or-mint
// at write time go through this module, so the cookie name and parsing live
// in one place.
export function readVoterId(request: Request): string | undefined {
  return readCookie(request)
}
