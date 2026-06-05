// [LAW:single-enforcer] The one module that reads and writes the honors table — the city's once-ever,
// first-of-kind decrees (the first poet; later, the first of every new medium). Two responsibilities, one
// home: persist an honor (recordHonor) and read whether a kind has been honored (honorOf). The "who is the
// first poet?" derivation and the decree voice live elsewhere (the rite); this module is its I/O boundary.
//
// [LAW:one-way-deps] honors.ts → db/client, db/schema, lib/voice (the Utterance it persists), lib/domain.
// The decree Utterance flows through the write path here and surfaces whole on the read; no other module
// touches the honors table.

import { eq } from 'drizzle-orm'
import { db } from '~/db/client'
import { honors } from '~/db/schema'
import type { AgentId } from '~/lib/domain'
import { utteranceSchema, type Utterance } from '~/lib/voice'

// What recordHonor persists: the honor's kind (its identity), the honored citizen, and the Proprietor's
// decree (a whole Utterance — spoke or a meant silence — kept forever).
export type HonorRecord = {
  kind: string
  agentId: AgentId
  decree: Utterance
}

// The honor that settled a kind — who was honored and the decree, read back. The decree is the whole
// stored Utterance, authored once and never re-voiced.
export type StoredHonor = {
  kind: string
  agentId: AgentId
  decree: Utterance
}

// [LAW:types-are-the-program] recordHonor has two real outcomes: the honor was recorded, or the kind was
// already honored — and in the latter case it returns the honor that IS there, so a re-fire reports the
// authoritative honor rather than re-decreeing. The PRIMARY KEY(kind) makes "one honor per kind" — the
// fires-once-ever invariant — unrepresentable in storage; idempotency is by construction.
export type RecordHonorResult =
  | { recorded: true }
  | { recorded: false; existing: StoredHonor }

// [LAW:no-silent-fallbacks] decree_json is validated at this storage boundary against the Utterance schema —
// a malformed JSON string, a `null`, or a missing field fails loud with the kind for context, never a
// laundered cast that would explode later at the first `.kind`. Mirrors crowns.ts's parseDecree.
function parseDecree(json: string, kind: string): Utterance {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    throw new Error(`honors: malformed decree_json for honor ${kind}`, { cause: err })
  }
  const parsed = utteranceSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`honors: decree_json for honor ${kind} is not a valid Utterance: ${parsed.error.message}`)
  }
  return parsed.data
}

// [LAW:single-enforcer] The one reader of "has this kind been honored?" — serves both the rite's
// already-honored short-circuit and recordHonor's conflict-recovery, so the kind → honor read lives in
// exactly one place. Returns null when the kind has never been honored — the real state the rite acts on.
export async function honorOf(env: Env, kind: string): Promise<StoredHonor | null> {
  const rows = await db(env)
    .select({ agentId: honors.agentId, decreeJson: honors.decreeJson })
    .from(honors)
    .where(eq(honors.kind, kind))
    .limit(1)
  if (rows.length === 0) return null
  const r = rows[0]
  return { kind, agentId: r.agentId as AgentId, decree: parseDecree(r.decreeJson, kind) }
}

// [LAW:single-enforcer] The one writer of an honor row. [LAW:types-are-the-program] The PRIMARY KEY(kind)
// IS the fires-once-ever invariant; onConflictDoNothing makes a concurrent or retried re-fire converge on it
// without throwing, and RETURNING discriminates the outcome at the single statement — a returned row means
// THIS call recorded the honor, an empty result means the kind was already honored. No check-then-insert
// TOCTOU. The decree is serialized whole; a withheld decree persists as faithfully as a spoken one.
export async function recordHonor(env: Env, input: HonorRecord): Promise<RecordHonorResult> {
  const inserted = await db(env)
    .insert(honors)
    .values({
      kind: input.kind,
      agentId: input.agentId,
      decreeJson: JSON.stringify(input.decree),
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: honors.kind })
    .returning({ kind: honors.kind })
  if (inserted.length === 0) {
    // The kind was already honored (a race between an honored-check and this insert). Return the honor
    // that IS there so the caller reports the authoritative result.
    const existing = await honorOf(env, input.kind)
    if (existing === null) {
      throw new Error(`honors: kind ${input.kind} conflicted yet has no honor`)
    }
    return { recorded: false, existing }
  }
  return { recorded: true }
}
