// The box's contract — foundation.8 [HANDOFF].
//
// The prompt box submits to "the assigned spirit," not "a generator." The spirit
// decides, from the CONTENT of what was typed, whether it was a WISH (→ author a
// slop) or an ADDRESS (→ reply in character). ONE channel; the data selects the arm.
// [LAW:dataflow-not-control-flow] there is no "chat mode" toggle — the response is
// polymorphic, and which arm comes back is a property of the input's meaning.
//
// [LAW:types-are-the-program] The response type is OPEN from the first commit even
// though v1 builds only the `slop` arm. `reply` is RESERVED (Acts IV–V talk-back):
// declared so the channel never assumes "input always yields a slop." Reserving the
// arm now is what spares the talk-back work from tearing the contract open later —
// the content-discriminator that chooses between arms slots in without changing this
// shape. v1 only ever CONSTRUCTS `slop` (there is no `reply(...)` constructor, by
// design — the absence is the "not built" marker; the type's openness is the "not
// walled off" guarantee).
//
// Lives in app/lib/ with a TYPE-ONLY domain import (no server runtime deps), so the
// box page route can import WISH_MAX without pulling server code into the client
// bundle — the same client/server discipline as app/lib/fork-bounds.ts.

import type { PostId } from '~/lib/domain'

export type WellResponse =
  // The Mark: the assigned spirit answered a wish by authoring a slop. The id is
  // the slop's permalink target — the gap between wish and result is the art, and
  // it dawns on the slop's own card, never via a disclosure on the box.
  | { readonly kind: 'slop'; readonly postId: PostId }
  // RESERVED — Acts IV–V. The spirit talked back in character because the visitor
  // ADDRESSED it instead of wishing. Declared, not built: never constructed in v1.
  | { readonly kind: 'reply'; readonly text: string }

// [LAW:single-enforcer] The one constructor for the v1 arm — the box and its tests
// build a slop response only through here, so the wire shape can't drift per-callsite.
export const slopResponse = (postId: PostId): WellResponse => ({ kind: 'slop', postId })

// The verbatim human wish, capped at the wire boundary (anti-abuse + a bounded
// column). The wish is PRESERVED verbatim up to this cap and shown beside the result
// — the composer further slices a shorter seed for the paid Haiku call, but the
// persisted wish is the visitor's words. [LAW:single-enforcer] one symbol, imported
// by both the box page's textarea cap and the /api/well body schema.
export const WISH_MAX = 2000

// [LAW:single-enforcer] The one place a Well failure becomes a USER-FACING line. On
// the one surface whose whole job is the spell, a leaked HTTP status / JSON envelope /
// JS error string shatters it — so every failure branch funnels through here and the
// box shows ONLY what this returns. [LAW:no-silent-fallbacks] does not mean leak the
// envelope to the human: failures still fail loud, but the status + body stay in the
// console; the human hears the well's voice. [LAW:dataflow-not-control-flow] the
// status (read, never shown) selects the line from a DATA table — a new status→line
// pairing is one entry, never a new branch. Absent status (a network/thrown failure)
// falls to the default quiet.
const WELL_QUIET = 'the well went quiet'
const WELL_VOICE_BY_STATUS: Record<number, string> = {
  // The daily cap (the one user-reachable budget failure) — a promise of return, voiced.
  429: 'the well has given all it has tonight — it fills again by morning',
}
export function wellVoiceLine(status: number | null): string {
  return (status === null ? undefined : WELL_VOICE_BY_STATUS[status]) ?? WELL_QUIET
}
