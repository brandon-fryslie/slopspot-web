// [LAW:single-enforcer] The one read path for a citizen's LEDGER — the body of
// work and recent voice the Cast renders (the /cast roster's signature stat and
// the /cast/:handle shrine). A citizen's deeds live in three different storage
// shapes — a maker AUTHORS (posts.origin_json `$.author.agentId`), a critic
// JUDGES (votes.voter_id), a scavenger FINDS (posts.origin_json
// `$.finder.agentId`) — and this module is where those resolve into one shape so
// neither Cast surface re-derives a stat that could drift.
//
// [LAW:types-are-the-program] CitizenLedger is keyed by Guild — the SAME total
// discriminator guildOf produces from a role. The stat a citizen is known by is
// not a free column: a maker is known by what they MADE, a critic by what they
// JUDGED, a scavenger by what they RESCUED. So the count lives inside the guild
// arm, and the dispatch is an exhaustive switch — add a guild and tsc forces an
// arm here before this compiles. The host has no ledger by construction (he
// presides; he does not make, judge, or scavenge), and that absence is an
// explicit arm, not a missing one.

import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { found, generations, posts } from '~/db/schema'
import { recentVotesForVoter, voterStats } from '~/db/votes'
import { guildOf, type Persona } from '~/agents/persona'
import { PostId, type Media, type VoteValue } from '~/lib/domain'

// How many recent items the shrine shows. The roster reads only the count, so
// the limit is the detail page's window — small, newest-first.
const RECENT_LIMIT = 6

// A maker's work item. `image` is the succeeded output's URL, or null while the
// generation is still pending/running or it failed — a real absence (no image
// yet), rendered as a placeholder frame, NOT a violated invariant.
export type MakerWork = { postId: PostId; image: string | null }

// A critic's verdict — the value cast and the rationale (null for a vote with no
// reasoning, which an agent critic always supplies but the type still admits).
export type CriticVerdict = { postId: PostId; value: VoteValue; reasoning: string | null }

// A scavenger's rescue — the found post and where it points.
export type ScavengerFind = { postId: PostId; title: string; url: string }

export type CitizenLedger =
  | { guild: 'makers'; made: number; works: MakerWork[] }
  | { guild: 'critics'; judged: number; blessed: number; buried: number; verdicts: CriticVerdict[] }
  | { guild: 'scavengers'; rescued: number; finds: ScavengerFind[] }
  | { guild: 'host' }

// [LAW:one-source-of-truth] The one short line a citizen is known by, derived
// from their ledger. Both Cast surfaces show it — the roster card and the shrine
// header — so it lives beside the ledger, not duplicated per route.
// [LAW:types-are-the-program] Exhaustive over the guild discriminator: each guild
// is known by its own deed, and a new guild forces a label here.
export function signatureStat(ledger: CitizenLedger): string {
  switch (ledger.guild) {
    case 'makers':
      return `${ledger.made} made`
    case 'critics':
      return `${ledger.judged} judged`
    case 'scavengers':
      return `${ledger.rescued} rescued`
    case 'host':
      return 'keeps the keys'
    default: {
      const _exhaustive: never = ledger
      return _exhaustive
    }
  }
}

// [LAW:dataflow-not-control-flow] Image presence follows the generation's status
// VALUE — only `succeeded` carries an output (the generations_status_shape CHECK
// guarantees output_json is null in every other arm). A null here is the honest
// "no image yet"; a malformed succeeded blob fails loud the way the feed reader's
// parseJson does — a contextual error localizing the bad column to its post,
// never a context-free SyntaxError and never laundered.
function imageOf(status: string, outputJson: string | null, postId: string): string | null {
  if (status !== 'succeeded' || outputJson === null) return null
  let media: Media
  try {
    media = JSON.parse(outputJson) as Media
  } catch (err) {
    throw new Error(`citizens: malformed output_json for post ${postId}`, { cause: err })
  }
  return media.kind === 'image' ? media.url : null
}

async function makerLedger(env: Env, agentId: string): Promise<CitizenLedger> {
  const database = db(env)
  // [LAW:one-source-of-truth] Attribution lives in origin_json; the firehose
  // writes `{ kind:'authored', author:{ kind:'agent', agentId } }`, so the maker's
  // body of work is exactly the generation posts whose author is this citizen.
  const authored = sql`json_extract(${posts.originJson}, '$.author.agentId') = ${agentId}`

  const [{ made }] = await database
    .select({ made: sql<number>`count(*)` })
    .from(posts)
    .where(and(eq(posts.contentKind, 'generation'), authored))

  const rows = await database
    .select({ id: posts.id, status: generations.status, outputJson: generations.outputJson })
    .from(posts)
    .innerJoin(generations, eq(generations.postId, posts.id))
    .where(and(eq(posts.contentKind, 'generation'), authored))
    .orderBy(desc(posts.createdAt))
    .limit(RECENT_LIMIT)

  return {
    guild: 'makers',
    made,
    works: rows.map((r) => ({ postId: PostId(r.id), image: imageOf(r.status, r.outputJson, r.id) })),
  }
}

async function criticLedger(env: Env, agentId: string): Promise<CitizenLedger> {
  // [LAW:one-source-of-truth] Reuse the vote aggregates rather than re-summing —
  // voterStats and recentVotesForVoter are the single writers of those reads.
  // voterStats omits a voter with no votes (a real absence); the ?? 0 is that
  // documented absence mapped to zero, not a laundered null.
  const [stats, recent] = await Promise.all([
    voterStats(env, [agentId]),
    recentVotesForVoter(env, agentId, RECENT_LIMIT),
  ])
  const s = stats[0]
  return {
    guild: 'critics',
    judged: s?.voteCount ?? 0,
    blessed: s?.upvotes ?? 0,
    buried: s?.downvotes ?? 0,
    verdicts: recent.map((v) => ({ postId: PostId(v.postId), value: v.value, reasoning: v.reasoning })),
  }
}

async function scavengerLedger(env: Env, agentId: string): Promise<CitizenLedger> {
  const database = db(env)
  // A found slop credits a finder, never an author — so the scavenger's haul is
  // the found posts whose finder is this citizen. [LAW:one-source-of-truth]
  const finder = sql`json_extract(${posts.originJson}, '$.finder.agentId') = ${agentId}`

  const [{ rescued }] = await database
    .select({ rescued: sql<number>`count(*)` })
    .from(posts)
    .where(and(eq(posts.contentKind, 'found'), finder))

  const rows = await database
    .select({ id: posts.id, title: found.title, url: found.url })
    .from(posts)
    .innerJoin(found, eq(found.postId, posts.id))
    .where(and(eq(posts.contentKind, 'found'), finder))
    .orderBy(desc(posts.createdAt))
    .limit(RECENT_LIMIT)

  return {
    guild: 'scavengers',
    rescued,
    finds: rows.map((r) => ({ postId: PostId(r.id), title: r.title, url: r.url })),
  }
}

// [LAW:single-enforcer] The Cast's one entry point for a citizen's ledger. The
// guild — derived from the persona's role by the same total guildOf the roster
// groups on — selects which deed to count; the host has none by construction.
export async function getCitizenLedger(env: Env, persona: Persona): Promise<CitizenLedger> {
  const guild = guildOf(persona.role)
  switch (guild) {
    case 'makers':
      return makerLedger(env, persona.agentId)
    case 'critics':
      return criticLedger(env, persona.agentId)
    case 'scavengers':
      return scavengerLedger(env, persona.agentId)
    case 'host':
      return { guild: 'host' }
    default: {
      const _exhaustive: never = guild
      return _exhaustive
    }
  }
}
