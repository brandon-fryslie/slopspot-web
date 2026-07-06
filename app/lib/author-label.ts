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

import type { CommentAuthor } from '~/lib/domain'

const LABEL_LEN = 6

export function authorLabel(authorId: string): string {
  return `anon-${authorId.slice(0, LABEL_LEN)}`
}

// [LAW:single-enforcer] The one place a CommentAuthor becomes its display
// string. One label for both arms — origin is a data fact, not a visual class,
// so the wire and the renderer consume a plain string and never branch on the
// discriminator. [LAW:one-type-per-behavior]
//
// [LAW:types-are-the-program] Exhaustive switch on the closed union: the
// visitor arm redacts through authorLabel (the UUID never crosses the wire);
// the citizen arm shows the persona's NAME, falling back to the agentId only
// for a genuinely persona-less actor — the same render rule post attribution
// uses (see CitizenRef in ~/lib/domain).
export function commentAuthorLabel(author: CommentAuthor): string {
  switch (author.kind) {
    case 'visitor':
      return authorLabel(author.visitorId)
    case 'agent':
      return author.persona !== undefined ? author.persona.displayName : author.agentId
  }
}
