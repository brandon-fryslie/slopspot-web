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
import { PostId } from '~/lib/domain'
import type { AgentId, CrownMark, Genome, RiteLens, VoteValue } from '~/lib/domain'
import { geneticDistance } from '~/lib/genome-distance'

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
//   acclaim — the Miracle alone, and it is the CORRECT exception, not the democratic
//             inversion the monarchical fix removed (that was the Saint going
//             whole-city; it is now a citizen's ballot). The Miracle is the one rite
//             the HOST presides — and the host keeps no ballot, he hosts but does not
//             vote — so a citizen's-taste crown is impossible here by construction.
//             Its whole point is the slop that is plainly, universally good: clean
//             beauty IS consensus, so the city's own verdict (highest score, lowest
//             curse) is the honest ballot, not a betrayal of the thesis. Do NOT
//             "correct" this to a citizen ballot. [LAW:one-source-of-truth]
//   deviance — the Heretic (Tuesday, "the image that defied its own recipe"). NOT a
//             vote: a RECIPE property. The candidates are the day's generations, and
//             the crown goes to the greatest genetic OUTLIER within its own declared
//             style-family cohort — the slop that wears the family name yet is least
//             like the siblings who chose it. Reads no citizen's ballot, so like
//             acclaim it nominates no specific voter; unlike acclaim its candidate is
//             a deviance scalar (devianceRanking), not a vote score.
export type RiteBallot =
  | { readonly kind: 'sole'; readonly citizen: AgentId; readonly pole: 'blessed' | 'buried' }
  | { readonly kind: 'feud'; readonly blessedBy: AgentId; readonly buriedBy: AgentId }
  | { readonly kind: 'acclaim' }
  | { readonly kind: 'deviance' }

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
// NOTE on the Heretic: the doc's ballot is a RECIPE property ("most defied its own
// style family"), so it reads the deviance ballot — the greatest genetic outlier
// within its declared style-family cohort. Vesper still PRESIDES (she is the rite's
// face, "the rule-breaker"); the ballot just isn't her vote.
export const RITES: readonly RiteDef[] = [
  { lens: 'saint', title: 'The Sainting', presiding: VIVIAN, dayOfWeek: 0, ballot: { kind: 'sole', citizen: VIVIAN, pole: 'blessed' } },
  { lens: 'villain', title: 'The Villain', presiding: GREMLIN, dayOfWeek: 1, ballot: { kind: 'sole', citizen: GREMLIN, pole: 'blessed' } },
  { lens: 'heretic', title: 'The Heretic', presiding: VESPER, dayOfWeek: 2, ballot: { kind: 'deviance' } },
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
    case 'deviance':
      // The deviance ballot reads recipes, not votes — no citizen nominates.
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

// [LAW:types-are-the-program] The ballot is the DAY's votes — "St. Vivian's strongest
// blessing OF THE DAY" (the-daily-rite.md). The window is the 24h preceding the
// ceremony: a half-open [sinceMs, untilMs) interval over votes.created_at (a vote's
// time, NOT a post's — so a citizen blessing an OLD slop today still nominates it,
// which is exactly how the Ragpicker resurrects a Relic). Without it the rite would
// re-crown the same all-time favourite every night and the daily novelty would die.
export type RiteWindow = { readonly sinceMs: number; readonly untilMs: number }

// The span of a rite's ballot — one day. The window is [ceremony − 1 day, ceremony).
export const RITE_WINDOW_MS = 24 * 60 * 60 * 1000

// The Proprietor's hour: the ceremony fires at 3am UTC (workers/app.ts `0 3 * * *`),
// and the hour BEFORE it — [2am, 3am) UTC — is the Deliberation, the city's held
// breath. These two constants are the ONLY place the rite's wall-clock hours are named.
export const CROWNING_HOUR_UTC = 3
export const DELIBERATION_HOUR_UTC = 2

// [LAW:types-are-the-program] The banner's two real time-states, made data: the
// Deliberation (the 2–3am held breath, carrying the very window the imminent ceremony
// will weigh so the contenders shown are the ceremony's own evidence) or the Standing
// hour (the settled crown reigns). A third "it is the crowning instant" is NOT a state
// — 3am is the cron's, not the banner's; the crown simply becomes the new Standing crown.
export type RitePhaseClock =
  | { readonly kind: 'deliberation'; readonly window: RiteWindow }
  | { readonly kind: 'standing' }

// [LAW:no-ambient-temporal-coupling] The rite's clock as a PURE function of one
// timestamp — the home loader reads `Date.now()` ONCE at its boundary and derives the
// phase here; no component reads the wall clock, so the banner cannot drift into a
// time-branch of its own. [LAW:dataflow-not-control-flow] the hour is the discriminator
// the loader switches on, and the Deliberation carries its window as a VALUE rather than
// re-deriving it downstream.
export function ritePhaseClock(nowMs: number): RitePhaseClock {
  const d = new Date(nowMs)
  if (d.getUTCHours() !== DELIBERATION_HOUR_UTC) return { kind: 'standing' }
  // The ceremony fires at 3am UTC of the SAME calendar day the 2am hour belongs to;
  // its ballot window ends there, exactly as runRite computes it. Votes after `nowMs`
  // do not exist yet, so an untilMs of the imminent 3am reads only what has been cast.
  const untilMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), CROWNING_HOUR_UTC)
  return { kind: 'deliberation', window: { sinceMs: untilMs - RITE_WINDOW_MS, untilMs } }
}

// [LAW:types-are-the-program] A candidate the rite weighs — discriminated by what the
// ballot READS, because vote ballots and the deviance ballot draw on different evidence
// and bundling both shapes into one bag-of-optionals would let every consumer reach for
// a field its ballot never populates. The ballot kind picks the arm: sole/feud/acclaim
// gather `voted`, the Heretic's deviance gathers `deviant`. gatherCandidates keeps each
// nightly list homogeneous (one ballot drives both gather and elect), so elect narrows
// the union once per family, never mixes the two.
//
//   voted   — `overallScore` is the day's SUM(votes) (the acclaim ballot reads it; it
//             breaks ties for the "strongest" of a citizen's nominees). `citizenVotes`
//             carries ONLY the ballot citizens' votes on this slop in the window (a
//             citizen who did not vote is ABSENT — a real absence, not a 0). No new
//             voting mechanic: every number is a vote already cast within the day.
//   deviant — `deviance` is the recipe-side score: the mean genetic distance from this
//             slop's own style-family cohort (devianceRanking). No vote is read.
export type VotedCandidate = {
  readonly kind: 'voted'
  readonly postId: PostId
  readonly overallScore: number
  readonly citizenVotes: Readonly<Record<string, VoteValue>>
}
export type DeviantCandidate = {
  readonly kind: 'deviant'
  readonly postId: PostId
  readonly deviance: number
}
export type RiteCandidate = VotedCandidate | DeviantCandidate

// [LAW:variability-at-edges] The Heretic's deviance is THIS ballot's policy, computed at
// coq.6's edge from the STRUCTURED geneticDistance primitive (which stays two-axis and
// ignorant of any weighting — the scalar lives only here, never upstream). A genome's
// deviance is the MEAN genetic distance to its OWN style-family cohort: how unlike the
// siblings who chose the same family it is. MEAN (not sum) so a populous family cannot
// out-score a sparse one by headcount alone.
// [LAW:types-are-the-program] A cohort of one has no sibling to defy — no orthodoxy, so
// no heresy — and yields NO candidate (a real absence, not a deviance of 0). The two
// non-commensurable axes (geneMismatches, which within a fixed species ranges 0..3, and
// traitDrift 0..4) collapse to a scalar by SUM here: the consumer's chosen weighting,
// lawfully at the edge. Pure over genomes — no I/O, fully unit-testable; the caller
// (crowns.gatherCandidates) supplies the in-window succeeded genomes.
export function devianceRanking(genomes: readonly Genome[]): DeviantCandidate[] {
  const bySpecies = new Map<string, Genome[]>()
  for (const g of genomes) {
    const cohort = bySpecies.get(g.genes.species) ?? []
    cohort.push(g)
    bySpecies.set(g.genes.species, cohort)
  }
  const candidates: DeviantCandidate[] = []
  for (const cohort of bySpecies.values()) {
    if (cohort.length < 2) continue
    for (const g of cohort) {
      let sum = 0
      for (const sibling of cohort) {
        if (sibling === g) continue
        const d = geneticDistance(g, sibling)
        sum += d.geneMismatches + d.traitDrift
      }
      // genome.id IS the post id (the 1:1 in L1) — the crown is recorded against the post.
      candidates.push({ kind: 'deviant', postId: PostId(g.id), deviance: sum / (cohort.length - 1) })
    }
  }
  return candidates
}

// [LAW:types-are-the-program] The election's two real outcomes: a crowning, or an
// Unmoved Day. The Unmoved Day is a first-class VALUE the orchestrator handles by
// structure (voice the Proprietor, persist no crown) — never a skipped branch.
export type Election =
  | { readonly kind: 'crowned'; readonly postId: PostId }
  | { readonly kind: 'unmoved' }

// [LAW:one-type-per-behavior] The ONE extreme-picker, over any candidate carrying a
// postId — the ranked VALUE is the only thing that differs between ballots (overallScore
// for votes, deviance for the Heretic), so it is a parameter (`valueOf`), not a second
// function. `high` for a blessing/acclaim/deviance, `low` for a burial. Ties break by
// postId descending so a given feed always crowns the same slop. Returns undefined for
// an empty set (no nominee → Unmoved Day).
function pickExtreme<T extends { readonly postId: PostId }>(
  candidates: readonly T[],
  valueOf: (c: T) => number,
  dir: 'high' | 'low',
): T | undefined {
  let best: T | undefined
  for (const c of candidates) {
    if (best === undefined) {
      best = c
      continue
    }
    const better = dir === 'high' ? valueOf(c) > valueOf(best) : valueOf(c) < valueOf(best)
    const tie = valueOf(c) === valueOf(best) && c.postId > best.postId
    if (better || tie) best = c
  }
  return best
}

const crowned = (c: { readonly postId: PostId } | undefined): Election =>
  c === undefined ? { kind: 'unmoved' } : { kind: 'crowned', postId: c.postId }

// [LAW:dataflow-not-control-flow] The ballot value decides the election; the body is
// residue of the union. sole/feud NOMINATE from a citizen's own ballot — the city's
// loudest post is NOT a candidate unless the presiding citizen voted for it (the
// monarchical thesis), so there is no intensity floor: the citizen's vote IS the bar,
// and an empty nominee set is the honest Unmoved Day ("Vivian blessed nothing today").
// acclaim is the one democratic lens: highest overall score, gated by `threshold` so
// it crowns intensity, never the mid. deviance is the Heretic's recipe ballot: the
// greatest outlier within its own style-family cohort.
export function elect(
  ballot: RiteBallot,
  candidates: readonly RiteCandidate[],
  threshold: number,
): Election {
  if (ballot.kind === 'deviance') {
    // [LAW:no-silent-fallbacks] A day whose most-deviant genome is still identical to its
    // cohort (deviance 0 — total conformity) crowns NOTHING: an honest Unmoved Day over a
    // heretic who defied nothing. The bar is 0 by nature, not a tuned constant — any real
    // deviation qualifies (a significance floor, if ever wanted, is a one-line edge tune).
    const deviant = candidates.filter((c): c is DeviantCandidate => c.kind === 'deviant')
    const best = pickExtreme(deviant, (c) => c.deviance, 'high')
    return best !== undefined && best.deviance > 0 ? crowned(best) : { kind: 'unmoved' }
  }

  // sole/feud/acclaim all read the vote candidates; gather hands this election a
  // homogeneous list (one ballot drives both), so narrowing the union here is exhaustive
  // handling, not a defensive guard.
  const voted = candidates.filter((c): c is VotedCandidate => c.kind === 'voted')
  switch (ballot.kind) {
    case 'sole': {
      const want: VoteValue = ballot.pole === 'blessed' ? 1 : -1
      const nominees = voted.filter((c) => c.citizenVotes[ballot.citizen] === want)
      return crowned(pickExtreme(nominees, (c) => c.overallScore, ballot.pole === 'blessed' ? 'high' : 'low'))
    }
    case 'feud': {
      const nominees = voted.filter(
        (c) => c.citizenVotes[ballot.blessedBy] === 1 && c.citizenVotes[ballot.buriedBy] === -1,
      )
      return crowned(pickExtreme(nominees, (c) => c.overallScore, 'high'))
    }
    case 'acclaim': {
      const best = pickExtreme(voted, (c) => c.overallScore, 'high')
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
