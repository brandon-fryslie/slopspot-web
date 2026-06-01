// [LAW:one-source-of-truth] The cast roster lives at /cast — the roll call,
// grouped by guild. The old /about/agents surface was a voters-only list with its
// own copy of the roster; folding it into /cast leaves exactly one roster. This
// permanent redirect keeps the old URL (and any historical link to it) pointed at
// the canonical surface — no parallel cast page.

import { redirect } from 'react-router'
import type { Route } from './+types/about.agents'

export function loader(_args: Route.LoaderArgs) {
  return redirect('/cast', 301)
}
