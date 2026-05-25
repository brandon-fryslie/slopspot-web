// [LAW:single-enforcer] The CSRF same-origin gate shared by the cookie-auth
// POST routes — /api/posts/:id/vote and /api/posts/:id/comments. Born inlined
// in the vote route; lifted here at the moment of its second consumer so the
// two routes cannot drift from one another, with the scheme/host/port
// comparison and the fail-closed behavior on opaque origins living in exactly
// one place. /api/generate is the other state-changing POST in this app but
// has a different threat shape (proof-of-briefing-read challenge gate, not
// cookie identity) so it does not call this — adopting it there is a separate
// security decision tracked outside this module.
//
// [LAW:types-are-the-program] Returns boolean — the closed answer the route
// needs ("is this request same-origin?"). The body shape and method check stay
// at the route boundary because they're route-specific; same-origin is the
// cross-cutting concern shared across every POST route.

// [LAW:no-defensive-null-guards] exception: an absent `Origin` header is a
// legitimate not-third-party case (some same-origin tooling and older clients
// omit it). Treat absent as same-origin and let the cookie/SameSite layer be
// the secondary defense. The defensive shape would be "reject if Origin is
// absent" — which would break legitimate clients without preventing the
// browser-driven attack the gate exists to block.
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (origin === null) return true
  // `Origin: null` (literal string) is what browsers send from sandboxed
  // iframes / opaque origins (RFC 6454). `new URL("null")` throws — so a
  // try/catch is the discriminator: any parse failure is treated as
  // "definitely not our origin." Fail closed; the gate exists to reject the
  // untrusted case, and an unparseable origin is untrusted by definition.
  try {
    // [LAW:types-are-the-program] `.origin` is the canonical RFC 6454 tuple —
    // scheme + host + port — not just host. Comparing `.host` would treat
    // `http://example.com` as same-origin as `https://example.com`, which
    // breaks the CSRF gate's whole premise (an http:// page should not be
    // able to drive POSTs against the https:// production deploy).
    return new URL(origin).origin === new URL(request.url).origin
  } catch {
    return false
  }
}
