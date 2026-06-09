// [LAW:single-enforcer] The one read path for the Pulse — the city's heartbeat.
// A time-ordered stream of recent civic events, derived ENTIRELY from existing
// rows (posts / votes / found). [LAW:one-source-of-truth] there is no event-log
// table; an event is a projection of a post or a vote that already happened.
//
// Two storage sources feed one stream:
//   - posts → posted (a citizen generated) | rescued (a citizen dragged one in)
//   - agent votes (reasoning IS NOT NULL) → blessed (+1) | buried (-1)
//
// The persona NAME resolves two ways because the storage shapes differ, and each
// is the natural fit: a vote's voter_id IS the agent's id (a real SQL join key),
// while a post's author/finder id lives inside origin_json (parsed in JS, like
// feed.ts). Both funnel through ONE batched personas lookup so a name is resolved
// in exactly one place. [LAW:dataflow-not-control-flow] the variant rides on the
// data; nothing branches on whether to surface an event — the list it builds is
// the list it returns.

import { and, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm'
import { db } from '~/db/client'
import { found, personas, posts, utterances, votes } from '~/db/schema'
import { PostId, type RiteLens } from '~/lib/domain'
import { feastsToday } from '~/db/crowns'

// [LAW:types-are-the-program] A `born` event is POST-LESS — a birth welcomes a citizen, not a slop — so
// it carries no postId (the renderer links the others to /p/:id; this one is an unlinked announcement).
// Its `text` is the Proprietor's stored welcome line, which already NAMES the newcomer (the names were
// baked at utter time — an utterance is a historical quote), so no read-time persona resolution is needed.
export type PulseEvent =
  | { kind: 'posted'; ts: number; persona: string; postId: PostId; title: string }
  | { kind: 'rescued'; ts: number; persona: string; postId: PostId }
  | { kind: 'blessed'; ts: number; persona: string; postId: PostId; title: string; reasoning: string }
  | { kind: 'buried'; ts: number; persona: string; postId: PostId; title: string; reasoning: string }
  | { kind: 'born'; ts: number; text: string }
  // [LAW:types-are-the-program] A `feast` event is the city remembering one of its dead — a
  // venerated slop whose canonisation anniversary falls today. It links to /p/:id (the saint
  // returns to view) and carries its lens so the strip can wear the crown's own mark tone.
  // Stamped with the loader's nowMs (a feast is today's standing event, not a fresh act), so
  // it sorts to the head of the stream the whole feast day.
  | { kind: 'feast'; ts: number; persona: string; postId: PostId; lens: RiteLens }

const PULSE_LIMIT = 12

// [LAW:types-are-the-program] Generation posts carry no title (the naming column
// is a later ticket). The neutral noun is a data default applied at the boundary
// so every event downstream carries a guaranteed `title: string` — graceful
// degradation, not a crash, and a one-line change to read real titles once they
// exist.
const UNTITLED = 'a piece'

// [LAW:single-enforcer] Storage→domain parse for the actor reference. The current
// Origin discriminated union nests the agent under author/finder/uploader; the
// pre-attribution legacy shape used a single `actor`. A non-agent actor (a human
// uploader/finder) has no persona to name, so it is not a resident event — return
// null and let it fall out of the stream. A malformed blob fails loud, matching
// feed.ts. [LAW:no-silent-fallbacks]
function actorAgentId(originJson: string, postId: string): string | null {
  let raw: {
    author?: { kind?: string; agentId?: string }
    finder?: { kind?: string; agentId?: string }
    uploader?: { kind?: string; agentId?: string }
    actor?: { kind?: string; agentId?: string }
  }
  try {
    raw = JSON.parse(originJson)
  } catch (err) {
    throw new Error(`pulse: malformed origin_json for post ${postId}`, { cause: err })
  }
  const a = raw.author ?? raw.finder ?? raw.uploader ?? raw.actor
  return a !== undefined && a.kind === 'agent' && typeof a.agentId === 'string' ? a.agentId : null
}

async function resolveNames(
  database: ReturnType<typeof db>,
  agentIds: readonly string[],
): Promise<Map<string, string>> {
  if (agentIds.length === 0) return new Map()
  const rows = await database
    .select({ agentId: personas.agentId, displayName: personas.displayName })
    .from(personas)
    .where(inArray(personas.agentId, [...agentIds]))
  const names = new Map<string, string>()
  for (const r of rows) names.set(r.agentId, r.displayName)
  return names
}

// A candidate is an event minus its resolved persona name — it carries the raw
// agentId until the batch lookup turns it into a named resident (or drops it).
type Candidate =
  | { kind: 'posted'; ts: number; agentId: string | null; postId: string; title: string }
  | { kind: 'rescued'; ts: number; agentId: string | null; postId: string }
  | { kind: 'blessed' | 'buried'; ts: number; agentId: string; postId: string; title: string; reasoning: string }

// [LAW:no-ambient-temporal-coupling] nowMs is the home loader's single clock, threaded
// in — the Pulse never reads the wall clock itself, and the feast source it composes
// reads against that same instant.
export async function getPulse(env: Env, nowMs: number): Promise<PulseEvent[]> {
  const database = db(env)

  // Recent posts (generation → posted, found → rescued; uploads are not civic
  // acts of a persona, so they are excluded at the boundary).
  const postRows = await database
    .select({
      id: posts.id,
      createdAt: posts.createdAt,
      contentKind: posts.contentKind,
      originJson: posts.originJson,
    })
    .from(posts)
    .where(ne(posts.contentKind, 'upload'))
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(PULSE_LIMIT)

  // Recent agent votes — reasoning IS NOT NULL is the agent-vote discriminator
  // (human/anon votes leave it null). voter_id IS the persona's agentId. The
  // found join surfaces a real title when the judged post is a found link.
  const voteRows = await database
    .select({
      voterId: votes.voterId,
      value: votes.value,
      reasoning: votes.reasoning,
      createdAt: votes.createdAt,
      postId: votes.postId,
      foundTitle: found.title,
    })
    .from(votes)
    .leftJoin(found, eq(found.postId, votes.postId))
    .where(isNotNull(votes.reasoning))
    .orderBy(desc(votes.createdAt))
    .limit(PULSE_LIMIT)

  const candidates: Candidate[] = []
  for (const r of postRows) {
    const ts = r.createdAt.getTime()
    const agentId = actorAgentId(r.originJson, r.id)
    candidates.push(
      r.contentKind === 'found'
        ? { kind: 'rescued', ts, agentId, postId: r.id }
        : { kind: 'posted', ts, agentId, postId: r.id, title: UNTITLED },
    )
  }
  for (const r of voteRows) {
    // isNotNull(reasoning) guarantees this; fail loud rather than launder a null
    // into the domain shape. [LAW:no-silent-fallbacks]
    if (r.reasoning === null) {
      throw new Error(`pulse: agent vote on ${r.postId} by ${r.voterId} has null reasoning`)
    }
    candidates.push({
      kind: r.value === 1 ? 'blessed' : 'buried',
      ts: r.createdAt.getTime(),
      agentId: r.voterId,
      postId: r.postId,
      title: r.foundTitle ?? UNTITLED,
      reasoning: r.reasoning,
    })
  }

  // [LAW:single-enforcer] The Birth Rite's welcomes — the Proprietor's birth utterances (occasion='birth',
  // post-less so targetPostId is null). Read straight off the utterances store; the line already names the
  // newcomer (baked at utter time), so unlike a vote there is no agentId to resolve — the text IS the event.
  const birthRows = await database
    .select({ text: utterances.text, createdAt: utterances.createdAt })
    .from(utterances)
    .where(and(eq(utterances.occasion, 'birth'), eq(utterances.kind, 'spoke')))
    .orderBy(desc(utterances.createdAt))
    .limit(PULSE_LIMIT)

  // [LAW:no-silent-fallbacks] kind='spoke' guarantees a non-null text (utterances_shape CHECK); a null
  // here is a storage-integrity violation, so fail loud rather than render an empty welcome.
  const bornEvents: PulseEvent[] = birthRows.map((r) => {
    if (r.text === null) {
      throw new Error('pulse: birth utterance has kind=spoke but null text')
    }
    return { kind: 'born', ts: r.createdAt.getTime(), text: r.text }
  })

  // [LAW:single-enforcer] The feast source — the city's venerated dead whose canonisation
  // anniversary falls on `nowMs`'s day, read through crowns.feastsToday (the one crown reader).
  // feastsToday already resolves the presiding citizen's name, so unlike a vote there is no
  // agentId to fold into the batch lookup — the feast is a fully-named event by the time it
  // arrives here. [LAW:dataflow-not-control-flow] no feast today is the empty list, no branch.
  const feastEvents: PulseEvent[] = (await feastsToday(env, nowMs)).map((f) => ({
    kind: 'feast',
    ts: nowMs,
    persona: f.presiding.displayName,
    postId: f.postId,
    lens: f.lens,
  }))

  const agentIds = new Set<string>()
  for (const c of candidates) if (c.agentId !== null) agentIds.add(c.agentId)
  const names = await resolveNames(database, [...agentIds])

  // [LAW:dataflow-not-control-flow] Only named residents are representable on the
  // ticker — an unresolved agentId (sys:slop-cron, an unseeded id) drops out by
  // data, not by a special case. Sort the merged stream and keep the most recent.
  const namedEvents = candidates
    .map((c): PulseEvent | null => {
      const persona = c.agentId === null ? undefined : names.get(c.agentId)
      if (persona === undefined) return null
      switch (c.kind) {
        case 'posted':
          return { kind: 'posted', ts: c.ts, persona, postId: PostId(c.postId), title: c.title }
        case 'rescued':
          return { kind: 'rescued', ts: c.ts, persona, postId: PostId(c.postId) }
        case 'blessed':
        case 'buried':
          return { kind: c.kind, ts: c.ts, persona, postId: PostId(c.postId), title: c.title, reasoning: c.reasoning }
      }
    })
    .filter((e): e is PulseEvent => e !== null)

  // [LAW:dataflow-not-control-flow] Births merge into the one stream as data — a born event sorts by its
  // ts alongside posts and votes, no separate ticker. Both sources already capped at PULSE_LIMIT; the
  // merge re-sorts and re-caps so the most recent civic acts win regardless of which source produced them.
  return [...namedEvents, ...bornEvents, ...feastEvents]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, PULSE_LIMIT)
}
