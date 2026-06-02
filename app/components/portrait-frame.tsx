// [LAW:one-source-of-truth] The single rendering of a citizen's portrait FRAME,
// shared by the roster and the shrine. The portrait STATE and its parse live in
// lib/portrait (pure, shared with the server-side regeneration pass); this module
// owns only the look of each state.
//
// [LAW:dataflow-not-control-flow] The frame's content follows the portrait STATE by
// an exhaustive switch — never a hardcoded branch per citizen, never an `if (url)`
// null-guard. A self-portrait (`rendered`) renders the asset; the Proprietor
// (`declined`) and the Gremlin (`refused`) render their first-class refusals; a
// citizen with no face yet renders the placeholder. Adding a state fails tsc here
// until its look is declared, so a new portrait state cannot fall through to a
// wrong default.

import { PROPRIETOR } from '~/lib/proprietor'
import type { PortraitState } from '~/lib/portrait'

function FrameInner({ portrait, displayName }: { portrait: PortraitState; displayName: string }) {
  switch (portrait.kind) {
    case 'rendered':
      // The citizen's self-portrait, in its own medium. object-cover crops any
      // aspect to the square frame so a 16:9 or 9:16 render still reads as a face.
      return (
        <img
          src={portrait.url}
          alt={`${displayName} — a self-portrait`}
          className="h-full w-full object-cover"
        />
      )
    case 'declined':
      // The Proprietor — never pictured. The frame holds the running gag, as data.
      return (
        <span className="px-3 text-center font-terminal text-[10px] uppercase tracking-[0.25em] text-ash">
          {PROPRIETOR.declinesToBeRendered}
        </span>
      )
    case 'refused':
      // The Gremlin — declines a portrait, and the refusal IS the character: a
      // downvote driven through the frame, the word he sends everything else to.
      return (
        <span
          aria-label="buried"
          className="flex flex-col items-center gap-1 font-terminal text-[11px] uppercase tracking-[0.2em] text-profane/80"
        >
          <span aria-hidden className="text-2xl leading-none text-profane/60">
            ▼
          </span>
          [buried]
        </span>
      )
    case 'unrendered':
      // No face yet — a maker before its first pass, or a citizen with no medium to
      // render in. The placeholder is the citizen's initial, faint behind the frame.
      return (
        <span
          aria-hidden
          className="select-none font-placard text-5xl font-black text-votive/10"
        >
          {displayName.slice(0, 1)}
        </span>
      )
    default: {
      const _exhaustive: never = portrait
      return _exhaustive
    }
  }
}

export function PortraitFrame({
  portrait,
  displayName,
}: {
  portrait: PortraitState
  displayName: string
}) {
  return (
    <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-sm border border-votive/15 bg-base">
      <FrameInner portrait={portrait} displayName={displayName} />
    </div>
  )
}
