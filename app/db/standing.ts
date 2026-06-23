// [LAW:single-enforcer] The one read path that turns the city's recent reception into a
// citizen's STANDING — the derived ASCENDANT/STEADY/FADING arc the roll call shows. The
// arc itself is pure (app/lib/standing.ts standingOf); this module is its I/O boundary,
// gathering each guild's reception currency into the two adjacent windows standingOf
// compares. [LAW:effects-at-boundaries] — the SQL lives here, the meaning lives there.
//
// [LAW:one-source-of-truth] Standing is never stored. It is recomputed from votes (and,
// for makers/scavengers, the SAME origin-attribution predicate citizens.ts counts deeds
// by) at read time — the same shape score=SUM(votes.value) takes in feed.ts. No standing
// column, no is_ascendant flag. The persistent state layer is the-civilization.md System IV.

import { and, eq, gte, inArray, sql, type SQL } from 'drizzle-orm'
import { db } from '~/db/client'
import { posts, votes } from '~/db/schema'
import { principalExpr } from '~/db/attribution'
import { guildOf, type Persona } from '~/agents/persona'
import { standingOf, type Momentum, type Standing } from '~/lib/standing'

// The width of each reception window. Standing compares the most-recent window against
// the one before it, so the arc spans twice this — a four-week read of whether a citizen
// is rising or fading. Wide enough that a quiet day or two does not flip the verdict.
// [LAW:one-source-of-truth] Exported because dynasty standing (dynasty-chronicle.ts) reads
// a bloodline's reception over the SAME span — so "ascendant" names the same time-scale on
// the Cast page and the dynasty page; one window policy, never two that could disagree.
export const STANDING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

// Reception per citizen, split into the two windows. A citizen absent from a result
// (no votes touched them in the span) is the honest zero — never a dropped row.
type Windowed = Map<string, Momentum>

// [LAW:dataflow-not-control-flow] Conditional aggregation, not two queries: one pass over
// the windowed votes tallies BOTH windows per citizen via a CASE in the SUM. recentStart
// splits the span; priorStart bounds it. The same two-window split serves every guild, so
// the shape is written once and the per-guild query only varies the currency it sums.
// [LAW:one-source-of-truth] Exported: dynasty standing (dynasty-chronicle.ts) sums the SAME
// net-votes-received currency over the SAME two-window split, only grouped by genome instead
// of by attributed citizen — so the window-split SQL is defined once here, never re-derived.
export function recentSum(recentStartMs: number): SQL<number> {
  return sql<number>`coalesce(sum(case when ${votes.createdAt} >= ${recentStartMs} then ${votes.value} else 0 end), 0)`
}
export function priorSum(recentStartMs: number, priorStartMs: number): SQL<number> {
  return sql<number>`coalesce(sum(case when ${votes.createdAt} >= ${priorStartMs} and ${votes.createdAt} < ${recentStartMs} then ${votes.value} else 0 end), 0)`
}
function recentCount(recentStartMs: number): SQL<number> {
  return sql<number>`coalesce(sum(case when ${votes.createdAt} >= ${recentStartMs} then 1 else 0 end), 0)`
}
function priorCount(recentStartMs: number, priorStartMs: number): SQL<number> {
  return sql<number>`coalesce(sum(case when ${votes.createdAt} >= ${priorStartMs} and ${votes.createdAt} < ${recentStartMs} then 1 else 0 end), 0)`
}

// Votes RECEIVED, grouped by the citizen whose post they landed on — the reception a
// maker or scavenger is judged by. The content kind + attribution slot are the only
// difference between the two guilds; everything else (the windowed split) is shared.
async function votesReceived(
  env: Env,
  contentKind: 'generation' | 'found',
  slot: 'author' | 'finder',
  recentStartMs: number,
  priorStartMs: number,
): Promise<Windowed> {
  const principal = principalExpr(slot)
  const rows = await db(env)
    .select({
      citizen: principal,
      recent: recentSum(recentStartMs),
      prior: priorSum(recentStartMs, priorStartMs),
    })
    .from(votes)
    .innerJoin(posts, eq(posts.id, votes.postId))
    .where(and(eq(posts.contentKind, contentKind), gte(votes.createdAt, new Date(priorStartMs))))
    .groupBy(principal)
  return new Map(rows.map((r) => [r.citizen, { recent: r.recent, prior: r.prior }]))
}

// Votes CAST, grouped by the critic who cast them — a critic's reception is their own
// activity (they are judged, they are not voted on), so the currency is count, not score:
// a critic on a judging streak ascends, one who has gone quiet fades. Bounded to the
// given critics; inArray([]) degrades to no rows by data, never a guard.
async function votesCast(
  env: Env,
  criticIds: readonly string[],
  recentStartMs: number,
  priorStartMs: number,
): Promise<Windowed> {
  const rows = await db(env)
    .select({
      citizen: votes.voterId,
      recent: recentCount(recentStartMs),
      prior: priorCount(recentStartMs, priorStartMs),
    })
    .from(votes)
    .where(and(inArray(votes.voterId, [...criticIds]), gte(votes.createdAt, new Date(priorStartMs))))
    .groupBy(votes.voterId)
  return new Map(rows.map((r) => [r.citizen, { recent: r.recent, prior: r.prior }]))
}

const ZERO: Momentum = { recent: 0, prior: 0 }

// [LAW:types-are-the-program] The guild selects the reception currency, and the host has
// none by construction — it presides, it does not make/judge/scavenge, so it has no arc
// (null), an explicit absence the renderer shows as no badge, never a fabricated "steady".
// Exhaustive over the guild discriminator: a new guild forces its currency here.
function momentumFor(
  guild: ReturnType<typeof guildOf>,
  agentId: string,
  received: Windowed,
  rescued: Windowed,
  cast: Windowed,
): Momentum | null {
  switch (guild) {
    case 'makers':
      return received.get(agentId) ?? ZERO
    case 'scavengers':
      return rescued.get(agentId) ?? ZERO
    case 'critics':
      return cast.get(agentId) ?? ZERO
    case 'host':
      return null
    default: {
      const _exhaustive: never = guild
      return _exhaustive
    }
  }
}

// [LAW:single-enforcer] The Cast's one entry point for derived standing — the roster
// reads it batched for the whole cast, the shrine for a single citizen (a one-element
// list). `nowMs` is passed in (the loader's Date.now()), keeping the window boundary an
// argument the reader is given rather than a clock it reaches for — testable, and the
// same now drives both surfaces in one request. A citizen with no standing (the host) is
// absent from the map; a citizen with no reception resolves to STEADY (the ZERO arc), so
// every non-host citizen is present.
export async function getStandings(
  env: Env,
  personas: readonly Persona[],
  nowMs: number,
): Promise<Map<string, Standing>> {
  const recentStartMs = nowMs - STANDING_WINDOW_MS
  const priorStartMs = nowMs - 2 * STANDING_WINDOW_MS

  // Critics are bounded to the loaded cast; the two received-reception reads group over
  // the windowed votes regardless of caller, so the window itself is their bound.
  const criticIds = personas.filter((p) => guildOf(p.role) === 'critics').map((p) => p.agentId)

  const [received, rescued, cast] = await Promise.all([
    votesReceived(env, 'generation', 'author', recentStartMs, priorStartMs),
    votesReceived(env, 'found', 'finder', recentStartMs, priorStartMs),
    votesCast(env, criticIds, recentStartMs, priorStartMs),
  ])

  const out = new Map<string, Standing>()
  for (const p of personas) {
    const m = momentumFor(guildOf(p.role), p.agentId, received, rescued, cast)
    // [LAW:no-defensive-null-guards] null is the host's genuine "no arc exists", a
    // discriminated absence — not a value to defend, but a citizen that carries no
    // standing at all, so it is simply omitted from the map.
    if (m === null) continue
    out.set(p.agentId, standingOf(m))
  }
  return out
}
