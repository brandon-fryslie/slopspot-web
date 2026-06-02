// [LAW:types-are-the-program] The Daily Rite's vocabulary and election, pure.
// design-docs/the-daily-rite.md: at 3am the city reads the extremes of the votes
// it already cast and crowns one slop — or, on an Unmoved Day, crowns nothing.
// This module owns the lens taxonomy (as DATA), the mark derivation, and the
// election (a pure function of candidates the caller gathered). It performs no
// I/O and speaks no voice — the orchestrator (app/agents/rite.ts) reads the votes,
// runs `elect`, voices the decree, and persists. The body here is residue of the
// types: a closed lens union and a closed pole union force every arm.

import { z } from 'zod'
import type { AgentId, CrownMark, PostId, RiteLens } from '~/lib/domain'

export type { RiteLens, CrownMark } from '~/lib/domain'

// [LAW:no-silent-fallbacks] Storage-boundary parse for the lens column. The
// crowns_lens_shape CHECK guarantees one of these, but a read re-validates the
// same way feed.ts re-parses styleFamily/aspectRatio — a drifted value fails loud
// rather than reaching markFor as an unhandled string.
export const riteLensSchema: z.ZodType<RiteLens> = z.enum([
  'saint',
  'villain',
  'heretic',
  'relic',
  'martyr',
  'miracle',
  'confession',
])

// [LAW:dataflow-not-control-flow] The pole a lens reads on the vote axis. The
// extreme it crowns is selected by THIS value, not by seven branches: `blessed`
// crowns the most-loved, `buried` the most-reviled monster, `divisive` the most
// split. Adding a reading is a new pole the election's exhaustive switch forces.
export type RitePole = 'blessed' | 'buried' | 'divisive'

// [LAW:one-type-per-behavior] The seven lenses are DATA, not seven types. Each
// binds its title, presiding citizen (the taste whose votes form the ballot), the
// liturgical day it presides, and the pole it reads. Retuning the week — a new
// presiding citizen, a different day — is an edit to this table, nothing else.
// [LAW:one-source-of-truth] presiding holds the STABLE agentId (personas PK), the
// id every other read keys on; the public handle/name resolve at read time.
export type RiteDef = {
  readonly lens: RiteLens
  readonly title: string
  readonly presiding: AgentId
  readonly dayOfWeek: number // 0=Sunday … 6=Saturday (UTC, the Proprietor's hour)
  readonly pole: RitePole
}

// The liturgical week (design-docs/the-daily-rite.md "The liturgical week").
// Presiding agentIds are the named cast's stable ids (drizzle/0017_persona_named_cast).
// Thursday's Martyr is "presided by the feud itself"; the Proprietor hosts the
// divided house, so he stands as its presider of record.
export const RITES: readonly RiteDef[] = [
  { lens: 'saint', title: 'The Sainting', presiding: 'agent:slop-purist' as AgentId, dayOfWeek: 0, pole: 'blessed' },
  { lens: 'villain', title: 'The Villain', presiding: 'agent:skeptic' as AgentId, dayOfWeek: 1, pole: 'buried' },
  { lens: 'heretic', title: 'The Heretic', presiding: 'agent:the-cursed-one' as AgentId, dayOfWeek: 2, pole: 'blessed' },
  { lens: 'relic', title: 'The Relic', presiding: 'agent:variety-hound' as AgentId, dayOfWeek: 3, pole: 'blessed' },
  { lens: 'martyr', title: 'The Martyr', presiding: 'agent:the-proprietor' as AgentId, dayOfWeek: 4, pole: 'divisive' },
  { lens: 'miracle', title: 'The Miracle', presiding: 'agent:the-proprietor' as AgentId, dayOfWeek: 5, pole: 'blessed' },
  { lens: 'confession', title: 'The Confession', presiding: 'agent:the-aesthete-gen' as AgentId, dayOfWeek: 6, pole: 'blessed' },
]

// [LAW:single-enforcer] The one map from a UTC weekday to the rite that presides.
// Total over 0..6 by construction (RITES covers every day); an out-of-range day is
// a caller bug and fails loud rather than silently picking a default lens.
export function riteForDay(dayOfWeek: number): RiteDef {
  const def = RITES.find((r) => r.dayOfWeek === dayOfWeek)
  if (def === undefined) {
    throw new Error(`rite: no lens presides over weekday ${dayOfWeek}`)
  }
  return def
}

// [LAW:types-are-the-program] The eternal mark's tone, derived from the lens by an
// exhaustive switch. Adding a RiteLens variant fails `tsc -b` at the `never` arm
// until its tone is declared — the mark can never go underived. Gold sanctifies,
// magenta profanes, bronze tarnishes with age, split honours the divided, bone is
// the flawless with nothing to forgive.
export function markFor(lens: RiteLens): CrownMark {
  switch (lens) {
    case 'saint':
      return 'gold'
    case 'villain':
      return 'magenta'
    case 'heretic':
      return 'magenta'
    case 'relic':
      return 'bronze'
    case 'martyr':
      return 'split'
    case 'miracle':
      return 'bone'
    case 'confession':
      return 'bone'
    default: {
      const _exhaustive: never = lens
      return _exhaustive
    }
  }
}

// [LAW:dataflow-not-control-flow] A candidate the rite weighs — a post and the
// vote-extreme signals ALREADY in the system. No new mechanic: `score` is
// SUM(votes.value), the same number the feed ranks by; `blessings`/`burials` are
// the up/down counts the divisive pole reads. The orchestrator gathers these from
// the votes table; `elect` only reads them.
export type RiteCandidate = {
  readonly postId: PostId
  readonly score: number
  readonly blessings: number
  readonly burials: number
}

// [LAW:types-are-the-program] The election's two real outcomes: a crowning, or an
// Unmoved Day. The Unmoved Day is a first-class VALUE the orchestrator handles by
// structure (voice the Proprietor, persist no crown) — never a skipped branch.
// [LAW:no-silent-fallbacks] "nothing cleared the bar" is `unmoved`, not a crowned
// mid quietly filling the slot.
export type Election =
  | { readonly kind: 'crowned'; readonly postId: PostId }
  | { readonly kind: 'unmoved' }

// The intensity each pole measures in a candidate. The Rite crowns intensity, never
// the mid — so the winner is the candidate with the greatest intensity, crowned
// only if that intensity clears `threshold`. Each pole's intensity is the honest
// reading of its extreme: a blessing's height, a burial's depth, a schism's lesser
// half (a thing is only divisive if BOTH camps turned out, so the weaker side
// bounds it).
function intensity(pole: RitePole, c: RiteCandidate): number {
  switch (pole) {
    case 'blessed':
      return c.score
    case 'buried':
      return -c.score
    case 'divisive':
      return Math.min(c.blessings, c.burials)
    default: {
      const _exhaustive: never = pole
      return _exhaustive
    }
  }
}

// [LAW:dataflow-not-control-flow] Same shape every call: score each candidate's
// intensity for the day's pole, take the strongest, crown it iff it clears the
// bar. An empty feed, or a feed where the strongest is still mid, both flow to the
// same `unmoved` value — the Unmoved Day is reached by data, not a guard. Ties
// break by postId descending so a given feed always crowns the same slop.
export function elect(
  pole: RitePole,
  candidates: readonly RiteCandidate[],
  threshold: number,
): Election {
  let best: { postId: PostId; intensity: number } | undefined
  for (const c of candidates) {
    const i = intensity(pole, c)
    if (
      best === undefined ||
      i > best.intensity ||
      (i === best.intensity && c.postId > best.postId)
    ) {
      best = { postId: c.postId, intensity: i }
    }
  }
  if (best === undefined || best.intensity < threshold) {
    return { kind: 'unmoved' }
  }
  return { kind: 'crowned', postId: best.postId }
}

// The intensity bar — how loud the votes must be for the crown to leave the drawer.
// A tunable creative constant, not a per-persona config (no homelab .strict() row);
// the Rite's standard for "not the mid." Below it on every candidate → Unmoved Day.
export const CROWN_INTENSITY_THRESHOLD = 3
