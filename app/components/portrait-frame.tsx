// [LAW:one-source-of-truth] The single rendering of a citizen's portrait FRAME,
// shared by the roster and the shrine. Self-portraits (rendered in each citizen's
// own medium) are a follow-up (roll-call-47p.6); until then the frame holds a
// placeholder, and for the one who declines to be rendered, an honored absence.
//
// [LAW:dataflow-not-control-flow] The frame's content follows the portrait STATE
// — a value derived from queryable persona config (config.portrait), not a
// hardcoded branch per citizen. 47p.6 adds a `rendered` state carrying a URL; the
// exhaustive switch below fails tsc until that arm is handled, so the new state
// cannot be silently swallowed into the placeholder.

import { PROPRIETOR } from '~/lib/proprietor'

// 'declined' — the Proprietor's running gag, sourced from config.portrait.
// 'pending' — a real portrait the city has not rendered yet (every other citizen
// this shell). The self-portrait work extends this union with a rendered arm.
export type PortraitState = 'declined' | 'pending'

// [LAW:one-source-of-truth] The 'declined' datum (config.portrait, written by the
// Proprietor's seed migration) is read in exactly one place — here, beside the
// type it produces. The self-portrait work reads the same config key for a
// rendered URL; co-locating the derivation keeps that contract in one spot.
export function portraitStateOf(config: Record<string, unknown>): PortraitState {
  return config.portrait === 'declined' ? 'declined' : 'pending'
}

function FrameInner({ portrait, displayName }: { portrait: PortraitState; displayName: string }) {
  switch (portrait) {
    case 'declined':
      return (
        <span className="px-3 text-center font-terminal text-[10px] uppercase tracking-[0.25em] text-ash">
          {PROPRIETOR.declinesToBeRendered}
        </span>
      )
    case 'pending':
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
