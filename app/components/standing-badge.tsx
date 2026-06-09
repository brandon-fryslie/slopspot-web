// The citizen's STANDING, made visible — the live drama of the roll call. A derived
// ASCENDANT/STEADY/FADING arc (app/lib/standing.ts), rendered as one chip in the
// pawnshop-cathedral register: the terminal-mono machine-stat type the Cast surfaces
// already use for newcomer and first-poet marks, so standing reads as kin to them.

import { standingDisplay, type Standing } from '~/lib/standing'

// [LAW:dataflow-not-control-flow] The tone is a lookup keyed by the standing value, not
// a branch: ASCENDANT glows in the votive warmth of a rising citizen, FADING dims toward
// the profane, STEADY sits in the neutral ash of the unremarkable. A new standing forces
// a tone here via the exhaustive Record.
const TONE: Record<Standing, string> = {
  ascendant: 'border-votive/40 bg-votive/10 text-votive',
  steady: 'border-ash/25 bg-ash/5 text-ash',
  fading: 'border-profane/30 bg-profane/5 text-profane/80',
}

// The chip is rendered only for a citizen that HAS a standing — the host, who presides
// rather than makes/judges/scavenges, carries none, so the caller renders nothing for it.
// That absence lives at the caller (a null standing selects no chip), keeping this
// component a pure function of a present Standing.
export function StandingBadge({ standing }: { standing: Standing }) {
  const { mark, label } = standingDisplay(standing)
  return (
    <span
      className={`inline-block rounded-sm border px-1.5 py-0.5 font-terminal text-[10px] uppercase tracking-[0.2em] ${TONE[standing]}`}
    >
      {mark} {label}
    </span>
  )
}
