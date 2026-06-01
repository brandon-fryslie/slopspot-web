// [LAW:single-enforcer] The one read path for a citizen's deeds — the signature
// stat the /cast roster shows and the recent voice/work the /cast/:handle shrine
// renders. A citizen's deeds live in three storage shapes — a maker AUTHORS
// (posts.origin_json `$.author.agentId`), a critic JUDGES (votes.voter_id), a
// scavenger FINDS (posts.origin_json `$.finder.agentId`) — and this module is
// where those resolve so neither Cast surface re-derives a count that could drift.
//
// [LAW:types-are-the-program] Two shapes, keyed by the SAME Guild discriminator
// guildOf produces. `CitizenStat` is the floor — the counts a citizen is known by
// (a maker by what they MADE, a critic by what they JUDGED, a scavenger by what
// they RESCUED), and all the roster needs. `CitizenLedger` extends that floor with
// the recent items the shrine renders. The roster reads the cheap floor; only the
// shrine pays for recent works/verdicts/haul and the output_json parse — so a
// malformed image blob can never 500 a roster that does not render images. The
// host has neither by construction (he presides; he does not make, judge, or
// scavenge), an explicit arm, never a missing one.

import { and, desc, eq, sql, type SQL } from 'drizzle-orm'
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

// A critic's verdict — the value cast and the rationale. `reasoning` is
// meaningful text or null: a human vote carries none, and the vote schema admits
// an empty/whitespace string which is normalized to null at the boundary below so
// "no rationale" has exactly one representation the renderer can branch on.
export type CriticVerdict = { postId: PostId; value: VoteValue; reasoning: string | null }

// A scavenger's rescue — the found post. `title` is null for an orphan found
// post (no `found` sibling row yet — D1 batch inserts are non-transactional), a
// real absence the shrine renders as an untitled rescue, NOT a dropped row.
export type ScavengerFind = { postId: PostId; title: string | null }

// The counts a citizen is known by — the roster's floor.
export type CitizenStat =
  | { guild: 'makers'; made: number }
  | { guild: 'critics'; judged: number; blessed: number; buried: number }
  | { guild: 'scavengers'; rescued: number }
  | { guild: 'host' }

// [LAW:types-are-the-program] The shrine's shape IS the stat floor plus the recent
// items it renders — each arm is its CitizenStat arm intersected with its recent
// items. Encoding the extension (rather than re-listing the fields) makes "a
// ledger is a stat-plus-more" a type guarantee: signatureStat's CitizenStat
// parameter accepts a CitizenLedger by construction, not by coincidence, so a
// future change to the floor flows into the ledger and the shrine call sites stay
// sound.
export type CitizenLedger =
  | (Extract<CitizenStat, { guild: 'makers' }> & { works: MakerWork[] })
  | (Extract<CitizenStat, { guild: 'critics' }> & { verdicts: CriticVerdict[] })
  | (Extract<CitizenStat, { guild: 'scavengers' }> & { finds: ScavengerFind[] })
  | Extract<CitizenStat, { guild: 'host' }>

// [LAW:one-source-of-truth] The one short line a citizen is known by. It reads
// only the count floor (CitizenStat), and since a CitizenLedger extends that floor
// by construction the shrine passes its ledger here directly — both surfaces label
// the citizen identically.
// [LAW:types-are-the-program] Exhaustive over the guild discriminator: each guild
// is known by its own deed, and a new guild forces a label here.
export function signatureStat(stat: CitizenStat): string {
  switch (stat.guild) {
    case 'makers':
      return `${stat.made} made`
    case 'critics':
      return `${stat.judged} judged`
    case 'scavengers':
      return `${stat.rescued} rescued`
    case 'host':
      return 'keeps the keys'
    default: {
      const _exhaustive: never = stat
      return _exhaustive
    }
  }
}

// [LAW:one-source-of-truth] The attribution predicates — the ONE definition of
// "this citizen's posts." A maker AUTHORS, a scavenger FINDS; pre-attribution rows
// carry the legacy `{ actor:{ agentId } }` shape that migration 0016 left in place
// for cleanly-mappable posts, so each predicate resolves the specific slot THEN the
// legacy actor — exactly as the feed reader's `author ?? actor` / `finder ?? actor`
// does, or the ledger would undercount older posts the feed still attributes here.
// Both the count (stat) and the recent-item (ledger) reads share these, so they
// can never disagree on what counts.
function authoredBy(agentId: string): SQL {
  return sql`coalesce(
    json_extract(${posts.originJson}, '$.author.agentId'),
    json_extract(${posts.originJson}, '$.actor.agentId')
  ) = ${agentId}`
}

function foundBy(agentId: string): SQL {
  return sql`coalesce(
    json_extract(${posts.originJson}, '$.finder.agentId'),
    json_extract(${posts.originJson}, '$.actor.agentId')
  ) = ${agentId}`
}

// [LAW:dataflow-not-control-flow] Image presence follows the generation's status
// VALUE — only `succeeded` carries an output (the generations_status_shape CHECK
// guarantees output_json is null in every other arm). A null status (an orphan
// generation post with no sibling row, surfaced by the leftJoin below) and an
// unfinished/failed status both mean the honest "no image yet"; a malformed
// succeeded blob fails loud the way the feed reader's parseJson does — a
// contextual error localizing the bad column to its post, never a context-free
// SyntaxError and never laundered.
function imageOf(status: string | null, outputJson: string | null, postId: string): string | null {
  if (status !== 'succeeded' || outputJson === null) return null
  let media: Media
  try {
    media = JSON.parse(outputJson) as Media
  } catch (err) {
    throw new Error(`citizens: malformed output_json for post ${postId}`, { cause: err })
  }
  return media.kind === 'image' ? media.url : null
}

async function makerStat(env: Env, agentId: string): Promise<Extract<CitizenStat, { guild: 'makers' }>> {
  const [{ made }] = await db(env)
    .select({ made: sql<number>`count(*)` })
    .from(posts)
    .where(and(eq(posts.contentKind, 'generation'), authoredBy(agentId)))
  return { guild: 'makers', made }
}

async function makerWorks(env: Env, agentId: string): Promise<MakerWork[]> {
  // [LAW:one-source-of-truth] leftJoin (not inner) so this lists the SAME post set
  // makerStat counts — `made` counts every generation post, so a post whose
  // generations sibling has not landed (orphan; batch inserts are non-transactional)
  // must still appear here (as a no-image frame), never be silently dropped into a
  // made-vs-works mismatch. The feed reader stays the single fail-loud enforcer for
  // orphans; the shrine renders the post and links to it.
  const rows = await db(env)
    .select({ id: posts.id, status: generations.status, outputJson: generations.outputJson })
    .from(posts)
    .leftJoin(generations, eq(generations.postId, posts.id))
    .where(and(eq(posts.contentKind, 'generation'), authoredBy(agentId)))
    .orderBy(desc(posts.createdAt))
    .limit(RECENT_LIMIT)
  return rows.map((r) => ({ postId: PostId(r.id), image: imageOf(r.status, r.outputJson, r.id) }))
}

// [LAW:one-source-of-truth] Reuse the vote aggregates rather than re-summing —
// voterStats is the single writer of that read. voterStats omits a voter with no
// votes (a real absence); the ?? 0 is that documented absence mapped to zero,
// not a laundered null.
async function criticStat(env: Env, agentId: string): Promise<Extract<CitizenStat, { guild: 'critics' }>> {
  const s = (await voterStats(env, [agentId]))[0]
  return {
    guild: 'critics',
    judged: s?.voteCount ?? 0,
    blessed: s?.upvotes ?? 0,
    buried: s?.downvotes ?? 0,
  }
}

async function criticVerdicts(env: Env, agentId: string): Promise<CriticVerdict[]> {
  const recent = await recentVotesForVoter(env, agentId, RECENT_LIMIT)
  return recent.map((v) => {
    // [LAW:types-are-the-program] Collapse "no rationale" to one representation at
    // this boundary: the vote schema admits an empty/whitespace string, which is
    // semantically the same absence as null, so the renderer branches on null
    // alone and never paints an empty (unlabeled) verdict line.
    const reasoning = v.reasoning?.trim() ? v.reasoning.trim() : null
    return { postId: PostId(v.postId), value: v.value, reasoning }
  })
}

async function scavengerStat(env: Env, agentId: string): Promise<Extract<CitizenStat, { guild: 'scavengers' }>> {
  const [{ rescued }] = await db(env)
    .select({ rescued: sql<number>`count(*)` })
    .from(posts)
    .where(and(eq(posts.contentKind, 'found'), foundBy(agentId)))
  return { guild: 'scavengers', rescued }
}

async function scavengerFinds(env: Env, agentId: string): Promise<ScavengerFind[]> {
  // [LAW:one-source-of-truth] leftJoin (not inner) for the same reason as
  // makerWorks: this lists the SAME post set scavengerStat counts, so an orphan
  // found post (sibling not yet landed) appears as an untitled rescue rather than
  // creating a rescued-vs-haul mismatch. The shrine links to the permalink; the
  // feed remains the single fail-loud enforcer for orphans.
  const rows = await db(env)
    .select({ id: posts.id, title: found.title })
    .from(posts)
    .leftJoin(found, eq(found.postId, posts.id))
    .where(and(eq(posts.contentKind, 'found'), foundBy(agentId)))
    .orderBy(desc(posts.createdAt))
    .limit(RECENT_LIMIT)
  return rows.map((r) => ({ postId: PostId(r.id), title: r.title }))
}

// [LAW:single-enforcer] The Cast's one cheap entry point for a citizen's counts —
// the roster reads exactly this, no recent-item queries and no output_json parse.
// The guild (from the same total guildOf the roster groups on) selects which deed
// to count; the host has none by construction.
export async function getCitizenStat(env: Env, persona: Persona): Promise<CitizenStat> {
  const guild = guildOf(persona.role)
  switch (guild) {
    case 'makers':
      return makerStat(env, persona.agentId)
    case 'critics':
      return criticStat(env, persona.agentId)
    case 'scavengers':
      return scavengerStat(env, persona.agentId)
    case 'host':
      return { guild: 'host' }
    default: {
      const _exhaustive: never = guild
      return _exhaustive
    }
  }
}

// [LAW:single-enforcer] The Cast's one entry point for a citizen's full ledger —
// the shrine reads this. The counts come from the same per-guild stat readers the
// roster uses (so they cannot drift), composed with the recent items that surface
// the citizen's voice and work.
export async function getCitizenLedger(env: Env, persona: Persona): Promise<CitizenLedger> {
  const guild = guildOf(persona.role)
  switch (guild) {
    case 'makers': {
      const [stat, works] = await Promise.all([
        makerStat(env, persona.agentId),
        makerWorks(env, persona.agentId),
      ])
      return { guild: 'makers', made: stat.made, works }
    }
    case 'critics': {
      const [stat, verdicts] = await Promise.all([
        criticStat(env, persona.agentId),
        criticVerdicts(env, persona.agentId),
      ])
      return { guild: 'critics', judged: stat.judged, blessed: stat.blessed, buried: stat.buried, verdicts }
    }
    case 'scavengers': {
      const [stat, finds] = await Promise.all([
        scavengerStat(env, persona.agentId),
        scavengerFinds(env, persona.agentId),
      ])
      return { guild: 'scavengers', rescued: stat.rescued, finds }
    }
    case 'host':
      return { guild: 'host' }
    default: {
      const _exhaustive: never = guild
      return _exhaustive
    }
  }
}
