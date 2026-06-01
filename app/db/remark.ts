// [LAW:single-enforcer] The one writer of a slop's signed remark — the answerer's
// in-character line about a wish it answered (foundation.7). Sibling of votes.ts /
// comments.ts: a focused single-writer for one generation-row field, kept off
// createPost so the post-creation enforcer stays about creation, not narration.
//
// [LAW:one-way-deps] remark.ts → db/client, db/schema, lib/voice (Utterance type).
// No back-edge. The voice layer NARRATES a completed slop (voice.ts: "the act is
// already done"), so the remark is recorded AFTER createPost, never woven into it.
//
// The remark is the first instance of the voice layer. When the voice-layer session
// builds a general utterances surface, this writer is where the remark's storage
// reconciles — the SHAPE it persists (an `Utterance`) is already the voice layer's.

import { eq } from 'drizzle-orm'
import { db } from '~/db/client'
import { generations } from '~/db/schema'
import type { PostId } from '~/lib/domain'
import type { Utterance } from '~/lib/voice'

// [LAW:types-are-the-program] Persist the whole `Utterance`, not just its text. A
// spoke line and a chosen silence are different VALUES the voice layer renders
// differently; collapsing `withheld` to a null TEXT column would erase that
// distinction. JSON keeps the discriminated union intact across the round-trip.
//
// One UPDATE keyed by post id. remark_json is orthogonal to the generations status
// CHECK, so this write is valid in any status arm — it never has to coordinate with
// the running→succeeded transition createPost owns.
export async function recordRemark(
  env: Env,
  postId: PostId,
  remark: Utterance,
): Promise<void> {
  const result = await db(env)
    .update(generations)
    .set({ remarkJson: JSON.stringify(remark) })
    .where(eq(generations.postId, postId))

  // [LAW:no-silent-fallbacks] drizzle's mapRunResult never inspects D1Result.success,
  // so a failed UPDATE resolves without throwing. Fail loud — a silently dropped
  // remark would masquerade downstream as the voice layer's "no utterance" (a chosen
  // absence), which is a different fact than "the write failed." The caller decides
  // whether a failed remark is fatal to the slop (it is not — see authorSlop).
  const raw = result as unknown as { success: boolean; error?: string; meta?: { changes?: number } }
  if (!raw.success) {
    throw new Error(`recordRemark: generations UPDATE failed for ${postId}: ${raw.error ?? 'unknown'}`)
  }
  // [LAW:no-silent-fallbacks] A succeeded UPDATE that changed 0 rows means the target
  // generation row was absent — the remark went nowhere. That is the exact silent
  // drop this writer exists to prevent (a missing remark must not masquerade as the
  // voice layer's "no utterance"), so completing the loud-failure contract means
  // catching it too, not only the D1-error case above. Only assert when the result
  // reports a row count; a shape without `changes` is not evidence of 0.
  if (raw.meta?.changes === 0) {
    throw new Error(`recordRemark: generations UPDATE changed 0 rows for ${postId} (no such generation)`)
  }
}
