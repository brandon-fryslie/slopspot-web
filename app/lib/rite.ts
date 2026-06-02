// [LAW:types-are-the-program] The Daily Rite's vocabulary and election, pure.
// design-docs/the-daily-rite.md: the rite is MONARCHICAL, not democratic — each rite
// is "presided over by a citizen, and THAT CITIZEN'S own daily votes are the ballot"
// (St. Vivian's strongest blessing → the Saint; the monster the Gremlin couldn't
// bring himself to bury → the Villain). The Martyr is the FEUD — the same slop one
// citizen blessed and another buried. The Miracle alone is the city's democratic
// acclaim ("highest score, lowest curse"). This module owns the lens taxonomy and the
// ballots as DATA, the mark derivation, and the election (pure over candidates the
// caller gathered). No I/O, no voice — the orchestrator reads the votes, runs `elect`,
// voices the decree, and persists.

import { z } from 'zod'
import type { AgentId, CrownMark, PostId, RiteLens, VoteValue } from '~/lib/domain'

export type { RiteLens, CrownMark } from '~/lib/domain'

// [LAW:no-silent-fallbacks] Storage-boundary parse for the lens column. The
// crowns_lens_shape CHECK guarantees one of these, but a read re-validates the same
// way feed.ts re-parses styleFamily/aspectRatio — a drifted value fails loud rather
// than reaching markFor as an unhandled string.
export const riteLensSchema: z.ZodType<RiteLens> = z.enum([
  'saint',
  'villain',
  'heretic',
  'relic',
  'martyr',
  'miracle',
  'confession',
])

// [LAW:types-are-the-program] The ballot is the program: it IS which election the
// city runs, encoded as a closed union the election switches over exhaustively.
//   sole    — the presiding citizen's OWN ballot. The candidates are the slops THAT
//             citizen voted on with the pole's sign; no other voter nominates. This
//             is the monarchical heart of the thesis (the city crowns through one
//             citizen's taste, not a popularity count).
//   feud    — the Martyr (Thursday, "presides: the feud itself"). The intersection:
//             a slop one citizen blessed AND another buried — divisive by construction.
//             A single presiding agentId cannot express two citizens; this arm does.
//   acclaim — the Miracle alone. The doc's "highest score with the lowest curse" is
//             genuinely the city's democratic verdict; this is the ONE lens a
//             whole-feed score read is correct for.
export type RiteBallot =
  | { readonly kind: 'sole'; readonly citizen: AgentId; readonly pole: 'blessed' | 'buried' }
  | { readonly kind: 'feud'; readonly blessedBy: AgentId; readonly buriedBy: AgentId }
  | { readonly kind: 'acclaim' }

// [LAW:one-type-per-behavior] The seven lenses are DATA, not seven types. Each binds
// its title, the citizen recorded on the crown (presiding — the rite's FACE, who may
// differ from the ballot's voters), the liturgical day, and the ballot it reads.
// [LAW:one-source-of-truth] presiding holds the STABLE agentId (personas PK).
export type RiteDef = {
  readonly lens: RiteLens
  readonly title: string
  readonly presiding: AgentId // recorded on the crown for attribution (the rite's face)
  readonly dayOfWeek: number // 0=Sunday … 6=Saturday (UTC, the Proprietor's hour)
  readonly ballot: RiteBallot
}

const VIVIAN = 'agent:slop-purist' as AgentId
const GREMLIN = 'agent:skeptic' as AgentId
const VESPER = 'agent:the-cursed-one' as AgentId
const RAGPICKER = 'agent:variety-hound' as AgentId
const GUTTERMONK = 'agent:the-aesthete-gen' as AgentId
const PROPRIETOR = 'agent:the-proprietor' as AgentId

// The liturgical week (design-docs/the-daily-rite.md "The liturgical week").
// Presiding agentIds are the named cast's stable ids (drizzle/0017_persona_named_cast).
// NOTE on the Villain: the doc's "the monster the Gremlin couldn't bring himself to
// bury" is the slop the Gremlin BLESSED against his burying nature — so its ballot is
// the Gremlin's blessing, pole 'blessed'.
// NOTE on the Heretic: the doc's true ballot is a RECIPE property ("most defied its
// own style family") — not a vote. Until that recipe-deviation read exists, it is
// approximated as Vesper's blessing (she presides "the rule-breaker"); the recipe
// ballot is a flagged follow-up, not a silent stand-in.
export const RITES: readonly RiteDef[] = [
  { lens: 'saint', title: 'The Sainting', presiding: VIVIAN, dayOfWeek: 0, ballot: { kind: 'sole', citizen: VIVIAN, pole: 'blessed' } },
  { lens: 'villain', title: 'The Villain', presiding: GREMLIN, dayOfWeek: 1, ballot: { kind: 'sole', citizen: GREMLIN, pole: 'blessed' } },
  { lens: 'heretic', title: 'The Heretic', presiding: VESPER, dayOfWeek: 2, ballot: { kind: 'sole', citizen: VESPER, pole: 'blessed' } },
  { lens: 'relic', title: 'The Relic', presiding: RAGPICKER, dayOfWeek: 3, ballot: { kind: 'sole', citizen: RAGPICKER, pole: 'blessed' } },
  { lens: 'martyr', title: 'The Martyr', presiding: PROPRIETOR, dayOfWeek: 4, ballot: { kind: 'feud', blessedBy: VIVIAN, buriedBy: GREMLIN } },
  { lens: 'miracle', title: 'The Miracle', presiding: PROPRIETOR, dayOfWeek: 5, ballot: { kind: 'acclaim' } },
  { lens: 'confession', title: 'The Confession', presiding: GUTTERMONK, dayOfWeek: 6, ballot: { kind: 'sole', citizen: GUTTERMONK, pole: 'blessed' } },
]

// [LAW:single-enforcer] The one map from a UTC weekday to the rite that presides.
// Total over 0..6 by construction (RITES covers every day); an out-of-range day is a
// caller bug and fails loud rather than silently picking a default lens.
export function riteForDay(dayOfWeek: number): RiteDef {
  const def = RITES.find((r) => r.dayOfWeek === dayOfWeek)
  if (def === undefined) {
    throw new Error(`rite: no lens presides over weekday ${dayOfWeek}`)
  }
  return def
}

// [LAW:single-enforcer] The citizens whose votes a ballot reads — the only voters the
// gather needs to resolve per candidate. Acclaim reads no specific citizen (the whole
// city), so it contributes none. Total over the ballot union.
export function ballotCitizens(ballot: RiteBallot): readonly AgentId[] {
  switch (ballot.kind) {
    case 'sole':
      return [ballot.citizen]
    case 'feud':
      return [ballot.blessedBy, ballot.buriedBy]
    case 'acclaim':
      return []
    default: {
      const _exhaustive: never = ballot
      return _exhaustive
    }
  }
}

// [LAW:types-are-the-program] The eternal mark's tone, derived from the lens by an
// exhaustive switch. Adding a RiteLens variant fails `tsc -b` at the `never` arm until
// its tone is declared. Gold sanctifies, magenta profanes, bronze tarnishes with age,
// split honours the divided, bone is the flawless with nothing to forgive.
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

// [LAW:dataflow-not-control-flow] A candidate the rite weighs. `overallScore` is the
// whole city's SUM(votes) — the acclaim ballot reads it and it breaks ties for the
// "strongest" of a citizen's nominees. `citizenVotes` carries ONLY the ballot's
// citizens' votes on this slop (a citizen who did not vote is absent — a real absence,
// not a 0), which the sole/feud ballots nominate from. No new voting mechanic: every
// number here is a vote already cast.
export type RiteCandidate = {
  readonly postId: PostId
  readonly overallScore: number
  readonly citizenVotes: Readonly<Record<string, VoteValue>>
}

// [LAW:types-are-the-program] The election's two real outcomes: a crowning, or an
// Unmoved Day. The Unmoved Day is a first-class VALUE the orchestrator handles by
// structure (voice the Proprietor, persist no crown) — never a skipped branch.
export type Election =
  | { readonly kind: 'crowned'; readonly postId: PostId }
  | { readonly kind: 'unmoved' }

// The extreme of a candidate set by overall score — `high` for a blessing or acclaim,
// `low` for a burial. Ties break by postId descending so a given feed always crowns
// the same slop. Returns undefined for an empty set (no nominee → Unmoved Day).
function pickExtreme(
  candidates: readonly RiteCandidate[],
  dir: 'high' | 'low',
): RiteCandidate | undefined {
  let best: RiteCandidate | undefined
  for (const c of candidates) {
    if (best === undefined) {
      best = c
      continue
    }
    const better = dir === 'high' ? c.overallScore > best.overallScore : c.overallScore < best.overallScore
    const tie = c.overallScore === best.overallScore && c.postId > best.postId
    if (better || tie) best = c
  }
  return best
}

const crowned = (c: RiteCandidate | undefined): Election =>
  c === undefined ? { kind: 'unmoved' } : { kind: 'crowned', postId: c.postId }

// [LAW:dataflow-not-control-flow] The ballot value decides the election; the body is
// residue of the union. sole/feud NOMINATE from a citizen's own ballot — the city's
// loudest post is NOT a candidate unless the presiding citizen voted for it (the
// monarchical thesis), so there is no intensity floor: the citizen's vote IS the bar,
// and an empty nominee set is the honest Unmoved Day ("Vivian blessed nothing today").
// acclaim is the one democratic lens: highest overall score, gated by `threshold` so
// it crowns intensity, never the mid.
export function elect(
  ballot: RiteBallot,
  candidates: readonly RiteCandidate[],
  threshold: number,
): Election {
  switch (ballot.kind) {
    case 'sole': {
      const want: VoteValue = ballot.pole === 'blessed' ? 1 : -1
      const nominees = candidates.filter((c) => c.citizenVotes[ballot.citizen] === want)
      return crowned(pickExtreme(nominees, ballot.pole === 'blessed' ? 'high' : 'low'))
    }
    case 'feud': {
      const nominees = candidates.filter(
        (c) => c.citizenVotes[ballot.blessedBy] === 1 && c.citizenVotes[ballot.buriedBy] === -1,
      )
      return crowned(pickExtreme(nominees, 'high'))
    }
    case 'acclaim': {
      const best = pickExtreme(candidates, 'high')
      return best !== undefined && best.overallScore >= threshold ? crowned(best) : { kind: 'unmoved' }
    }
    default: {
      const _exhaustive: never = ballot
      return _exhaustive
    }
  }
}

// The intensity bar the ACCLAIM ballot must clear — how loud the whole city must be
// for the Miracle's crown to leave the drawer. A tunable creative constant (not a
// per-persona config, so no homelab .strict() row). The sole/feud ballots use no
// floor: a presiding citizen's vote is itself the bar.
export const CROWN_INTENSITY_THRESHOLD = 3
