// [LAW:dataflow-not-control-flow] The wished-slop reveal is PERSONAL. A wished slop
// is public — two audiences — and the copy is selected by the viewer==wisher DATA
// (RenderablePost.viewerIsModifier, computed at the read boundary), never a mode flag.
// The personal hijack lands hardest for the wisher; for a stranger the surface stays
// honest spectacle. The one absolute: we NEVER tell a stranger "what YOU wished" — we
// do not lie on this surface. These are the only two places the copy turns on viewer
// identity, owned here so the honesty invariant lives in one testable place.

// The wish-gap figcaption beside the result that ignored the wish: second-person for
// the wisher, passive third-person for everyone else.
export const wishGapCaption = (viewerIsModifier: boolean): string =>
  viewerIsModifier ? 'what you wished' : 'what was wished'

// The byline footnote subject ("from a wish by …"): "you" when the viewer is the human
// who occasioned the slop, otherwise that human's own label (the caller owns actor
// display, so the stranger label is passed in). "you" is the one viewer-aware token —
// a stranger always sees the label, never "you".
export const modifierSubject = (viewerIsModifier: boolean, label: string): string =>
  viewerIsModifier ? 'you' : label
