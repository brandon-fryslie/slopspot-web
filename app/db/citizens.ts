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

import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { db } from '~/db/client'
import { found, generations, posts } from '~/db/schema'
import { recentVotesForVoter, voterStats } from '~/db/votes'
import { guildOf, type Persona } from '~/agents/persona'
import { PostId, type Media, type VoteValue } from '~/lib/domain'
import { styleFamilySchema, type StyleFamily } from '~/lib/variety'

// How many recent items the shrine shows. The roster reads only the count, so
// the limit is the detail page's window — small, newest-first.
const RECENT_LIMIT = 6

// The answered-wishes window is the WIDER one on purpose: the Act-III reveal
// (the-reveal-contract.md Surface 2, lock 3) lands by BREADTH — the pattern "she
// does this to everyone" only dawns when many petitioners' wishes sit transmuted
// in one place, not from a single anecdote. So this panel windows deeper than the
// recency-window panels above; an early citizen with fewer than this shows what is
// real, and the Proprietor covers a citizen with none.
const ANSWERED_WISH_LIMIT = 12

// A maker's VOICE line — the placard he wrote, linked to its post. `title` is the
// AI-composed name (prompts/titles are AI-authored, so it is genuinely his voice,
// not a label about him), null for a legacy pre-placard row or an orphan generation
// post — one honest absence the shrine renders as an untitled piece, the SAME shape
// a scavenger's find carries.
// [LAW:one-source-of-truth] Deliberately NOT the feed's subject-derived fallback:
// that mechanical placard is a card-rendering convenience, never words the maker
// said, so it has no place in his voice.
// [LAW:single-enforcer] The VOICE read carries no image — the placards panel renders
// only the line, so it parses no output blob, and a malformed blob in a recent post
// can never 500 a panel that does not show it. Every image (and every output_json
// parse) belongs to the WORK panel, which hydrates only the highlights it shows.
export type MakerLine = { postId: PostId; title: string | null }

// A maker's WORK item — a curated highlight's image, plus the placard for context.
// `image` is the succeeded output's URL, or null while the generation is still
// pending/running or it failed — a real absence (no image yet), rendered as a
// placeholder frame, NOT a violated invariant.
export type MakerWork = { postId: PostId; title: string | null; image: string | null }

// [LAW:types-are-the-program] The four axes the WORK panel curates a maker by —
// his best, his most-bred, his latest, and pointedly a failure (showing the misses
// is more honest than a highlight reel). Each label carries exactly the datum it is
// known by — `best` the score it reached, `most-bred` the lineage it spawned — so
// the renderer reads the number off the label rather than re-deriving it, and a
// label that needs no number (latest, a failure) carries none. A piece can earn
// more than one axis (a maker's only post is his best AND his latest), so a
// highlight carries the SET of labels it earned, deduped to one thumbnail.
export type WorkLabel =
  | { kind: 'best'; score: number }
  | { kind: 'most-bred'; children: number }
  | { kind: 'latest' }
  | { kind: 'failure' }
export type MakerHighlight = MakerWork & { labels: WorkLabel[] }

// [LAW:types-are-the-program] One answered wish — a human's words and the slop the
// maker made of them, the gap shown side by side. `wish` is non-null by
// construction: the reader drops a blank wish at the boundary, so the panel never
// renders an empty quotation (the-reveal-contract.md Surface 2, lock 2 — real data
// only, never a faked or hollow wish). `title`/`image` are the SAME honest absences
// a MakerWork carries — an untitled placard, a slop still pending/failed — so the
// renderer branches on null exactly as the WORK panel does.
// [LAW:one-source-of-truth] The wish text is the SAME generations.wish the card's
// wish-gap shows; this panel is the second honest view of it, never a second copy.
export type AnsweredWish = { postId: PostId; wish: string; title: string | null; image: string | null }

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
  | (Extract<CitizenStat, { guild: 'makers' }> & {
      works: MakerLine[]
      highlights: MakerHighlight[]
      styles: StyleFamily[]
      // [LAW:types-are-the-program] Only a maker can answer a wish — the wish lives
      // on a generation, and only the makers' guild authors generations — so the
      // Act-III reveal field is representable on this arm ALONE. A critic or
      // scavenger with answered wishes is an illegal state the union cannot express.
      answeredWishes: AnsweredWish[]
    })
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
      // [LAW:dataflow-not-control-flow] A critic's signature is the verdict they
      // are KNOWN for, and the count that dominates their record IS that
      // disposition — St. Vivian blesses, The Gremlin buries. The data picks the
      // label; no per-critic special case. Ties resolve to blessed: the house is
      // reverent about garbage before it is savage about the mid (the-cast.md).
      return stat.blessed >= stat.buried
        ? `${stat.blessed} blessed`
        : `${stat.buried} buried`
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

// A feud flag the roster renders on a citizen's card — the standing rivalry made
// clickable, and nothing more. `rivalHandle` is the /cast URL key the flag links to
// (the fight is the rival's shrine); `rivalName` is the placard label. Both resolve
// from canon + the live roster, so a flag can only ever point at a citizen who is
// actually present and addressable.
// [LAW:types-are-the-program] The roster renders only the flag, so the type carries
// only the flag — the soap-opera `reason` prose lives on `Feud` (the shrine shape),
// not here, so the roster loader never serializes prose it does not show.
export type FeudFlag = { rivalHandle: string; rivalName: string }

// [LAW:types-are-the-program] The shrine's richer view of the same edge: which way
// the feud reads (this citizen DECLARES a grudge, or is TARGETED-BY one) plus the
// one-line `reason` prose the WORLD panel shows beneath it. Stance is the
// discriminator the panel renders different headlines for; both extend the bare flag
// because the shrine needs strictly more than the roster does. The Gremlin DECLARES
// nothing and is TARGETED-BY everyone; his WORLD is the city's whole feud map seen
// from the bottom.
export type Feud = FeudFlag & { reason: string; stance: 'declares' | 'targeted-by' }

// [LAW:one-source-of-truth] The city's feuds — editorial canon (the-cast.md "The
// feuds"; the rivalries written into the persona prompts), given their ONE
// machine-readable home. A feud is a DIRECTED edge keyed by the stable immutable
// handle (the /cast URL key minted in 0017, never the agentId): `from` carries a
// standing beef against `against`, narrated once by `reason` (the soap-opera line
// the shrine surfaces, written to read true from either end of the edge).
// Directed, not mutual, by design — the Gremlin is the fixed antagonist the city's
// feuds orbit (everyone flags him; he deigns to feud no one, he just buries), and
// the lone non-Gremlin front (the Formalist's contempt for the maximalist mess —
// a shot at Vesper) proves the relation is data, not a hardcoded target.
//
// [LAW:no-mode-explosion] Adding a feud = one row here, no code path. The set is
// the named cast's canon; it grows by the writers' room, not by a flag.
const FEUDS: ReadonlyArray<{ from: string; against: string; reason: string }> = [
  {
    from: 'guttermonk',
    against: 'the-gremlin',
    reason:
      'The Gremlin buries the stark work and reads meaning into the monk’s silence. There is none. That is the joke.',
  },
  {
    from: 'vesper-sloan',
    against: 'the-gremlin',
    reason:
      'Excess against restraint. He buries her overcooked disasters on sight; she captions straight through the burials, italics blazing.',
  },
  {
    from: 'st-vivian',
    against: 'the-gremlin',
    reason:
      'Mercy against judgment. She blesses what he buries; when they land on the same image from opposite poles, it is the day’s sharpest object.',
  },
  {
    from: 'the-formalist',
    against: 'vesper-sloan',
    reason:
      'His contempt for the maximalist mess — every dial turned up and the chaos called a choice. Composition against noise.',
  },
]

// [LAW:single-enforcer] The one resolver for a citizen's OUTGOING feud flags — the
// roster's lens. The caller passes the handle→displayName map it already built from
// the loaded personas (no extra query), and each outgoing edge resolves to the
// rival's name. An edge whose rival is absent from the live roster — un-minted,
// retired — collapses out by data, so a flag can never link to a dead /cast page.
// An un-minted citizen (null handle) matches no `from` and yields [] with no guard.
export function feudsFor(handle: string | null, roster: ReadonlyMap<string, string>): FeudFlag[] {
  return FEUDS.flatMap((f) => {
    if (f.from !== handle) return []
    const rivalName = roster.get(f.against)
    return rivalName === undefined ? [] : [{ rivalHandle: f.against, rivalName }]
  })
}

// [LAW:dataflow-not-control-flow] Each directed edge is also two STANCE VIEWS — the
// citizen who declares it, and the one it targets. Expanding the canon into those
// views up front turns "which end of this edge am I" from a branch into data, so
// the shrine's resolver below is the same flat filter the roster's feudsFor is.
const FEUD_VIEWS: ReadonlyArray<{ handle: string; other: string; reason: string; stance: Feud['stance'] }> =
  FEUDS.flatMap((f) => [
    { handle: f.from, other: f.against, reason: f.reason, stance: 'declares' },
    { handle: f.against, other: f.from, reason: f.reason, stance: 'targeted-by' },
  ])

// [LAW:single-enforcer] The shrine's lens on the same canon: every edge TOUCHING
// this citizen, each tagged with the stance the WORLD panel narrates. The Gremlin's
// shrine fills with the city's feuds (targeted-by) while the roster card he carries
// stays empty (he declares none). Same roster-resolution as feudsFor — an edge
// whose other end is absent from the live roster collapses out, never a dead link;
// an un-minted citizen (null handle) matches no view and yields [].
export function feudsAround(handle: string | null, roster: ReadonlyMap<string, string>): Feud[] {
  return FEUD_VIEWS.flatMap((v) => {
    if (v.handle !== handle) return []
    const rivalName = roster.get(v.other)
    return rivalName === undefined
      ? []
      : [{ rivalHandle: v.other, rivalName, reason: v.reason, stance: v.stance }]
  })
}

// The rite a citizen presides over — the day, the rite's name, and the axis of
// greatness it crowns. `blurb` is the public, in-register description of that
// taste; the Proprietor's nightly decree and the crowned piece are the Daily Rite's
// own concern, not this shrine's.
export type RitePresidency = { day: string; rite: string; blurb: string }

// [LAW:one-source-of-truth] The liturgical week (the-daily-rite.md) given its ONE
// machine-readable home, keyed by the same stable handle the feuds are. Each rite
// is bound to the citizen whose taste supplies its ballot — the city's structure
// (each star presides over their own axis, in public) made data. Thursday's Martyr
// presides over "the feud itself," no single citizen, so it has no row here; Idris
// and the Formalist hold a guild but no rite, so they resolve to null by absence —
// a real state the shrine omits, not a hole to fill. [LAW:no-mode-explosion] adding
// a presiding citizen is one row, no code path.
const RITES: Readonly<Record<string, RitePresidency>> = {
  'st-vivian': {
    day: 'Sunday',
    rite: 'The Sainting',
    blurb: 'The sublime-cursed — the beloved-and-broken image, transcendent through its flaw, canonized.',
  },
  'the-gremlin': {
    day: 'Monday',
    rite: 'The Villain',
    blurb: 'The gloriously wrong — the monster you cannot stop looking at, booed with love.',
  },
  'vesper-sloan': {
    day: 'Tuesday',
    rite: 'The Heretic',
    blurb: 'The rule-breaker — the generation that defied its own recipe and arrived somewhere forbidden.',
  },
  'the-ragpicker': {
    day: 'Wednesday',
    rite: 'The Relic',
    blurb: 'The survivor — a piece pulled up from the deep feed, honored for enduring the dark.',
  },
  'the-proprietor': {
    day: 'Friday',
    rite: 'The Miracle',
    blurb: 'Clean beauty — the rare one with no curse to forgive. Sometimes the machine simply closes its hand.',
  },
  guttermonk: {
    day: 'Saturday',
    rite: 'The Confession',
    blurb: 'The intimate — the quiet, devastating one that revealed something it was not asked to.',
  },
}

// [LAW:single-enforcer] The one resolver for a citizen's presidency. A handle with
// no rite (Idris, the Formalist) and an un-minted citizen (null handle) both
// resolve to null — the real "presides over nothing" the shrine omits, never a
// fabricated ceremony.
export function ritePresidedBy(handle: string | null): RitePresidency | null {
  return handle === null ? null : (RITES[handle] ?? null)
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

// [LAW:one-type-per-behavior] Collapse a blank line to one absence: a null
// (leftJoin miss / human vote), an empty string (legacy sentinel), or a
// whitespace-only string all mean "nothing was said here." A maker's placard
// and a critic's reasoning are the SAME normalization, so they share one helper
// rather than drifting on what counts as blank — and the trim happens once.
function blankToNull(text: string | null): string | null {
  const trimmed = text?.trim()
  return trimmed ? trimmed : null
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

async function makerWorks(env: Env, agentId: string): Promise<MakerLine[]> {
  // [LAW:one-source-of-truth] leftJoin (not inner) so this lists the SAME post set
  // makerStat counts — `made` counts every generation post, so a post whose
  // generations sibling has not landed (orphan; batch inserts are non-transactional)
  // must still appear here (as an untitled line), never be silently dropped into a
  // made-vs-voice mismatch. The feed reader stays the single fail-loud enforcer for
  // orphans; the shrine renders the line and links to it.
  const rows = await db(env)
    .select({ id: posts.id, title: generations.title })
    .from(posts)
    .leftJoin(generations, eq(generations.postId, posts.id))
    .where(and(eq(posts.contentKind, 'generation'), authoredBy(agentId)))
    // [LAW:one-source-of-truth] id is the stable tiebreak — created_at is
    // millisecond-resolution, so same-ms ties would otherwise let SQLite reorder
    // the placard list between reads.
    .orderBy(desc(posts.createdAt), asc(posts.id))
    .limit(RECENT_LIMIT)
  // [LAW:types-are-the-program] "No authored placard" is one absence — the maker
  // said nothing here — so the shrine branches on null alone, exactly as the
  // scavenger's untitled find and the critic's empty reasoning do.
  return rows.map((r) => ({ postId: PostId(r.id), title: blankToNull(r.title) }))
}

// What the highlight scan reads per post — the signals each WORK axis is picked by.
// No title/blob here: the scan ranks the whole body cheaply, and only the handful
// of winners are hydrated for their image (the heavy column) in a second pass.
type PickRow = { id: string; status: string | null; score: number; children: number }

// [LAW:dataflow-not-control-flow] Each axis is a pick that EXISTS in the data or
// does not — the highest-scored work (only if the city has voted it up), the
// most-forked (only if it bred), the newest, the newest failure. An absent signal
// is a null that filters out, never a branch that skips rendering; the canonical
// order (best · most-bred · latest · a failure) is the array order. A post that
// wins several axes appears once per axis here and is merged downstream, so the
// pick stage stays a flat list of (post, label) the renderer never has to dedupe.
function chooseHighlights(rows: PickRow[]): Array<{ postId: string; label: WorkLabel }> {
  // rows arrive newest-first, so `latest` is the head and `failure` is the first
  // failed row encountered — no separate sort, the query's order IS the recency.
  const argmaxBy = (key: (r: PickRow) => number): PickRow | null =>
    rows.reduce<PickRow | null>((best, r) => (best === null || key(r) > key(best) ? r : best), null)

  const top = argmaxBy((r) => r.score)
  const bred = argmaxBy((r) => r.children)
  const latest = rows[0] ?? null
  const failure = rows.find((r) => r.status === 'failed') ?? null

  const picks: Array<{ postId: string; label: WorkLabel } | null> = [
    top !== null && top.score > 0 ? { postId: top.id, label: { kind: 'best', score: top.score } } : null,
    bred !== null && bred.children > 0
      ? { postId: bred.id, label: { kind: 'most-bred', children: bred.children } }
      : null,
    latest !== null ? { postId: latest.id, label: { kind: 'latest' } } : null,
    failure !== null ? { postId: failure.id, label: { kind: 'failure' } } : null,
  ]
  return picks.filter((p): p is { postId: string; label: WorkLabel } => p !== null)
}

// [LAW:single-enforcer] The WORK panel's curated highlights — the one place a
// maker's body is ranked into its best/most-bred/latest/failure axes. The scan
// reads the whole body cheaply (score + lineage via correlated subqueries, no
// blobs); chooseHighlights ranks it; then the winners (≤4) are hydrated for their
// image in one bounded read. A post that vanishes between the two reads drops out
// rather than being `!`-asserted — a benign delete race, not a violated invariant.
async function makerHighlights(env: Env, agentId: string): Promise<MakerHighlight[]> {
  const database = db(env)
  const picksRows: PickRow[] = await database
    .select({
      id: posts.id,
      status: generations.status,
      score: sql<number>`coalesce((select sum(sv.value) from votes sv where sv.post_id = ${posts.id}), 0)`,
      children: sql<number>`(select count(*) from generations gc where gc.parent_post_id = ${posts.id})`,
    })
    .from(posts)
    .leftJoin(generations, eq(generations.postId, posts.id))
    .where(and(eq(posts.contentKind, 'generation'), authoredBy(agentId)))
    // [LAW:one-source-of-truth] id is the stable tiebreak under the ms-resolution
    // created_at, so `latest` (rows[0]), the newest-failure scan, and the
    // first-encountered-max in chooseHighlights all resolve deterministically
    // rather than flickering when two posts share a millisecond.
    .orderBy(desc(posts.createdAt), asc(posts.id))

  const picks = chooseHighlights(picksRows)

  // [LAW:dataflow-not-control-flow] Group the picks by post in their canonical
  // order — a Map preserves insertion order, so the first axis a post wins fixes
  // its slot and later axes merge their labels onto it. The empty body yields an
  // empty map and the hydrate read is skipped by an empty `inArray`, no guard.
  const labelsByPost = new Map<string, WorkLabel[]>()
  for (const { postId, label } of picks) {
    const labels = labelsByPost.get(postId)
    if (labels === undefined) labelsByPost.set(postId, [label])
    else labels.push(label)
  }

  const ids = [...labelsByPost.keys()]
  if (ids.length === 0) return []

  const hydrated = await database
    .select({
      id: posts.id,
      title: generations.title,
      status: generations.status,
      outputJson: generations.outputJson,
    })
    .from(posts)
    .leftJoin(generations, eq(generations.postId, posts.id))
    .where(inArray(posts.id, ids))
  const workById = new Map(
    hydrated.map((r) => [
      r.id,
      { postId: PostId(r.id), title: blankToNull(r.title), image: imageOf(r.status, r.outputJson, r.id) },
    ]),
  )

  return [...labelsByPost].flatMap(([id, labels]) => {
    const work = workById.get(id)
    return work === undefined ? [] : [{ ...work, labels }]
  })
}

// [LAW:one-source-of-truth] The aesthetic territory a maker works in most — the
// "works mostly in" line. innerJoin (not left) because an orphan post carries no
// style to count; styleFamilySchema re-parses at the storage boundary so an
// out-of-taxonomy value a raw writer slipped in fails loud here rather than
// rendering a bogus territory. Empty body → [] and the line degrades to nothing.
async function makerStyles(env: Env, agentId: string): Promise<StyleFamily[]> {
  const rows = await db(env)
    .select({ styleFamily: generations.styleFamily, n: sql<number>`count(*)` })
    .from(posts)
    .innerJoin(generations, eq(generations.postId, posts.id))
    .where(and(eq(posts.contentKind, 'generation'), authoredBy(agentId)))
    .groupBy(generations.styleFamily)
    // [LAW:one-source-of-truth] style_family is the stable tiebreak so tied
    // frequencies resolve deterministically — without it SQLite may reorder tied
    // rows between reads and the "works mostly in" line would flicker.
    .orderBy(desc(sql`count(*)`), asc(generations.styleFamily))
    .limit(3)
  return rows.map((r) => styleFamilySchema.parse(r.styleFamily))
}

// [LAW:single-enforcer] The Act-III reveal read — the wishes this maker seized and
// transmuted, each as the human's verbatim words beside the slop they became. The
// gap, repeated across petitioners, IS the reveal (the-reveal-contract.md Surface 2):
// the panel SHOWS the pattern, it never announces the hijack — the breadth makes the
// user conclude it. The non-blank wish predicate is the whole selection: only
// Well-born slops carry a wish, so unlike makerWorks there is no count to match and
// no orphan to surface. The output blob is parsed with the same fail-loud imageOf the
// WORK panel uses; a pending/failed slop is an honest null image, not a violated invariant.
async function answeredWishes(env: Env, agentId: string): Promise<AnsweredWish[]> {
  const rows = await db(env)
    .select({
      id: posts.id,
      wish: generations.wish,
      title: generations.title,
      status: generations.status,
      outputJson: generations.outputJson,
    })
    .from(posts)
    .innerJoin(generations, eq(generations.postId, posts.id))
    // [LAW:single-enforcer] The non-blank filter lives in SQL, BEFORE the limit, so the
    // window counts only real wishes — a legacy '' (or space-run) wish must not steal a
    // slot and underfill the panel below ANSWERED_WISH_LIMIT. `trim(wish) <> ''` is
    // null-safe (trim(NULL) is NULL, excluded), so it subsumes the "is Well-born" check.
    .where(and(eq(posts.contentKind, 'generation'), authoredBy(agentId), sql`trim(${generations.wish}) <> ''`))
    // [LAW:one-source-of-truth] id is the stable tiebreak under ms-resolution
    // created_at, so the windowed slice is deterministic across reads.
    .orderBy(desc(posts.createdAt), asc(posts.id))
    .limit(ANSWERED_WISH_LIMIT)
  // [LAW:types-are-the-program] blankToNull trims the stored wish for display and
  // narrows the nullable column to the non-null value the panel shows. The SQL filter
  // keeps the window full of real wishes; this JS pass is the type-honest narrowing of
  // a nullable column — and a backstop for the one whitespace SQLite's space-only
  // trim() misses (a tab/newline-only wish JS's .trim() collapses), which drops here
  // rather than rendering a hollow quotation. Real-data-only, at the boundary.
  return rows.flatMap((r) => {
    const wish = blankToNull(r.wish)
    return wish === null
      ? []
      : [{ postId: PostId(r.id), wish, title: blankToNull(r.title), image: imageOf(r.status, r.outputJson, r.id) }]
  })
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
  // [LAW:types-are-the-program] "No rationale" is one absence: the vote schema
  // admits an empty/whitespace string, the same absence as a human vote's null,
  // so the renderer branches on null alone and never paints an empty verdict line.
  return recent.map((v) => ({
    postId: PostId(v.postId),
    value: v.value,
    reasoning: blankToNull(v.reasoning),
  }))
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
  // [LAW:single-enforcer] Normalize the find title at the read boundary, the same
  // collapse the maker's placard and critic's reasoning take — so a blank title
  // (an orphan's null, a '' write) is one absence here and the renderer never has
  // to defend against an empty label it should never receive.
  return rows.map((r) => ({ postId: PostId(r.id), title: blankToNull(r.title) }))
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
      const [stat, works, highlights, styles, wishes] = await Promise.all([
        makerStat(env, persona.agentId),
        makerWorks(env, persona.agentId),
        makerHighlights(env, persona.agentId),
        makerStyles(env, persona.agentId),
        answeredWishes(env, persona.agentId),
      ])
      return { guild: 'makers', made: stat.made, works, highlights, styles, answeredWishes: wishes }
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
