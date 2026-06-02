// [LAW:one-source-of-truth] The single parse of a citizen's `config.portrait`
// datum, and the type it produces. Both the read-side surfaces (the card frame,
// the Cast pages) and the server-side regeneration pass (agents/portrait.ts) read
// the portrait through THIS module — there is no second interpretation of the
// config key. Pure (no I/O, no JSX), so the UI component and the cron pass both
// import it without dragging server code into the client bundle or a renderer into
// the worker.
//
// [LAW:types-are-the-program] A portrait is one of four states, and which one is
// DATA, never a per-citizen branch. `rendered` carries the asset (a state that
// cannot exist without its url); `declined` (the Proprietor) and `refused` (the
// Gremlin) are FIRST-CLASS character variants, not edge cases guarded around at the
// callsite; `unrendered` is the honest absence (a maker before its first pass, or a
// citizen with no medium to render in). The card and the Cast render this union by
// exhaustive match — adding a state breaks `tsc` at every consumer until handled,
// which is the point.

import { z } from 'zod'

// [LAW:types-are-the-program] The closed set of what a portrait frame can show.
// `declined`/`refused` carry no payload — the character IS the variant. `rendered`
// carries the content-addressed media url AND the wall-clock it was authored at:
// the url is the only thing the frame reads, the timestamp the only thing the drift
// scheduler reads, and co-locating them keeps one source of truth for "the citizen's
// current face." `unrendered` is a single state for two data shapes (absent config,
// or a config the schema rejects) because both show the same thing — a placeholder —
// so the will-it-ever-render question (a property of the medium, not the frame) does
// not belong in this type.
export type PortraitState =
  | { kind: 'rendered'; url: string; renderedAt: number }
  | { kind: 'declined' }
  | { kind: 'refused' }
  | { kind: 'unrendered' }

// [LAW:types-are-the-program] The config datum is an untrusted storage value
// (config_json is raw SQL-writable JSON), so it is parsed at this boundary, not
// trusted. Three legal shapes; everything else (absent, a typo, a half-written
// object) collapses to `unrendered` rather than throwing — a malformed portrait
// must never 500 the roster, and a placeholder is the honest render of "no usable
// portrait." The rendered arm demands BOTH a url and a timestamp so a half-written
// regeneration (url with no renderedAt) cannot masquerade as a fresh face the drift
// scheduler would then never revisit.
const renderedSchema = z.object({
  url: z.string().min(1),
  renderedAt: z.number().int().nonnegative(),
})

export function portraitStateOf(config: Record<string, unknown>): PortraitState {
  const raw = config.portrait
  if (raw === 'declined') return { kind: 'declined' }
  if (raw === 'refused') return { kind: 'refused' }
  const rendered = renderedSchema.safeParse(raw)
  if (rendered.success) {
    return { kind: 'rendered', url: rendered.data.url, renderedAt: rendered.data.renderedAt }
  }
  return { kind: 'unrendered' }
}
