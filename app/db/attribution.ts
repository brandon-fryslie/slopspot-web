// [LAW:single-enforcer][LAW:one-source-of-truth] The ONE definition of "whose post is
// this." A maker AUTHORS (origin_json `$.author.agentId`), a scavenger FINDS
// (`$.finder.agentId`); pre-attribution rows carry the legacy `{ actor: { agentId } }`
// shape migration 0016 left in place, so the principal is the specific slot coalesced to
// the legacy actor — exactly as the feed reader's `author ?? actor` / `finder ?? actor`
// resolves it. Every consumer that asks "this citizen's posts" — the Cast deed counts
// (citizens.ts), the derived Standing arc (standing.ts) — reads THIS expression, so they
// can never disagree on whose post a row is.
//
// [LAW:caches-are-derived] The json paths are written as LITERAL text (not `${}`
// interpolation, which Drizzle emits as a bound parameter) so a SQLite expression index
// declared on this exact expression — `posts_author_attribution_idx` /
// `posts_finder_attribution_idx`, migration 0033 — actually matches the query at plan
// time and the deed/reception reads become index SEEKs. A parameterized path would
// compile to `json_extract(origin_json, ?)`, a different expression tree the index can
// not serve. The literal-vs-bound distinction is invisible to results and decisive to
// the planner; the EXPLAIN gate in citizens.test.ts MEASURES that the seek holds.

import { sql, type SQL } from 'drizzle-orm'
import { posts } from '~/db/schema'

// The principal an attributed post belongs to — the specific slot, falling back to the
// legacy actor. `slot` is a closed two-value union, so each arm is the fully-enumerated
// literal expression; there is no string built from outside to splice, and the json
// paths stay literal SQL text the expression index can match.
export function principalExpr(slot: 'author' | 'finder'): SQL<string> {
  return slot === 'author'
    ? sql<string>`coalesce(json_extract(${posts.originJson}, '$.author.agentId'), json_extract(${posts.originJson}, '$.actor.agentId'))`
    : sql<string>`coalesce(json_extract(${posts.originJson}, '$.finder.agentId'), json_extract(${posts.originJson}, '$.actor.agentId'))`
}

// The predicate "this post is attributed to `agentId` via `slot`." The principal
// expression stays literal; only the compared agentId is a bound parameter — so the
// index on the expression serves the `<expr> = ?` seek.
export function attributedTo(slot: 'author' | 'finder', agentId: string): SQL {
  return sql`${principalExpr(slot)} = ${agentId}`
}
