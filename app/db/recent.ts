// [LAW:single-enforcer] The chooser's read-side dependency on storage lives here
// exactly once. Same shape as feed.ts (storage→domain trust boundary) but a
// narrower projection — the chooser doesn't need vote scores, Media, or
// origin, only the variety fields needed to apply R1–R6.
//
// [LAW:types-are-the-program] Returns a flat row of canonical literal-union
// types; the chooser reads them directly without further parsing. Failure to
// validate at this boundary throws (mirroring feed.ts) so a malformed row
// surfaces a localized error instead of laundering through the chooser into
// the next generated post.

import { desc, eq } from 'drizzle-orm'
import { db } from '~/db/client'
import { generations, posts } from '~/db/schema'
import { ProviderId, type AspectRatio, type StyleFamily } from '~/lib/domain'
import {
  aspectRatioSchema,
  storedSubjectTemplateIdSchema,
  styleFamilySchema,
  type StoredSubjectTemplateId,
} from '~/lib/variety'

// The chooser's view of a persisted recipe. Slots are a flat record because
// R6's per-slot-value tracking iterates keys without caring which template
// the slots came from — a generic Record absorbs every variant. (For trust
// boundary parity with feed.ts: the per-template shape *would* be enforced
// by recipeSubjectSchema, but the chooser doesn't need the discriminated
// union — it operates on the slot map plus the template-id string.)
export type RecentRecipe = {
  providerId: ProviderId
  styleFamily: StyleFamily
  subjectTemplate: StoredSubjectTemplateId
  slots: Record<string, string>
  aspectRatio: AspectRatio
}

// Trust-boundary parse for the slots column. The JSON is whatever createPost
// serialized (always a Record<string, string>), but we still verify shape
// here so a corrupted row fails loud at the boundary rather than confusing
// R6's slot-value iteration downstream.
function parseSlotsJson(raw: string, postId: string): Record<string, string> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (err) {
    throw new Error(`recent: malformed slots_json for post ${postId}`, { cause: err })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`recent: slots_json must be an object for post ${postId}`)
  }
  const out: Record<string, string> = {}
  for (const [key, slotValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof slotValue !== 'string') {
      throw new Error(
        `recent: non-string slot value for post ${postId} (slot=${key})`,
      )
    }
    out[key] = slotValue
  }
  return out
}

// [LAW:dataflow-not-control-flow] Always issues the same query; the result
// length is data (0..n). Bootstrap behavior (an empty DB returns []) is a
// natural consequence of the query, not a branch — the chooser's R-rules
// degrade gracefully on an empty window without any "first run" check.
//
// Includes failed/pending generations: per the design doc the window is "last
// N persisted posts" without status filter. The chooser is selecting against
// recent agent decisions, not against the visible feed, so a failed attempt
// at style X still counts as "we just tried X."
export async function getRecentRecipes(env: Env, n: number): Promise<RecentRecipe[]> {
  const database = db(env)
  const rows = await database
    .select({
      providerId: generations.providerId,
      styleFamily: generations.styleFamily,
      subjectTemplate: generations.subjectTemplate,
      slotsJson: generations.slotsJson,
      aspectRatio: generations.aspectRatio,
      postId: generations.postId,
    })
    .from(generations)
    .innerJoin(posts, eq(posts.id, generations.postId))
    // [LAW:types-are-the-program] Deterministic ordering: createdAt is
    // millisecond-resolution, so two rows can tie. The chooser's R1/R3/R4 use
    // recent[0] as a hard-reject driver — if "most recent" can flip-flop
    // between runs, the chooser's output stops being a function of (DB state,
    // scheduledTime). posts.id (UUID) is the stable tie-breaker that closes
    // that hole; ordering is by-time first, by-id second.
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(n)

  return rows.map((row) => ({
    providerId: ProviderId(row.providerId),
    styleFamily: styleFamilySchema.parse(row.styleFamily),
    subjectTemplate: storedSubjectTemplateIdSchema.parse(row.subjectTemplate),
    slots: parseSlotsJson(row.slotsJson, row.postId),
    aspectRatio: aspectRatioSchema.parse(row.aspectRatio),
  }))
}
