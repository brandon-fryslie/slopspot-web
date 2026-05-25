// [LAW:single-enforcer] The one place the anonymous-author display string is
// computed from a voter UUID. The cookie is HttpOnly, so a client cannot read
// its own slopspot_voter — but if the server echoes the raw UUID onto the
// wire, anyone can copy a visible authorId off another user's comment, set
// their own slopspot_voter cookie to that value in their own browser, and
// then post as that user. The full id must stay server-side for any future
// ownership/claim flow; only the label crosses the wire.
//
// [LAW:types-are-the-program] The label is what the UI actually consumes — the
// strongest true theorem about the wire is "a display affordance," not "an
// identity." Sending only `authorLabel: string` makes "leak the full UUID"
// structurally unrepresentable on the response, rather than relying on each
// route to remember to redact.

const LABEL_LEN = 6

export function authorLabel(authorId: string): string {
  return `anon-${authorId.slice(0, LABEL_LEN)}`
}
