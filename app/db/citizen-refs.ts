// [LAW:one-source-of-truth] [RECONCILE A] The ONE resolver of an agent's stable
// internal id (agentId) into its public CitizenRef (handle + displayName from the
// personas table). Every read surface that shows a citizen's name — post
// attribution in feed.ts, comment authorship in comments.ts — resolves through
// this batch fetch; none stores a redundant copy of the name.
//
// [LAW:types-are-the-program] A CitizenRef carries the citizen's NAME always and
// its handle (null until minted). Every resolved persona row produces one — the
// name is what attribution shows, the handle is what lights the /cast link. An
// agentId absent from the map is a genuinely persona-less actor (no row), whose
// renderer fallback is the agentId label — never an un-minted-but-named citizen.

import { inArray } from 'drizzle-orm'
import type { db } from '~/db/client'
import { personas } from '~/db/schema'
import type { CitizenRef } from '~/lib/domain'

// One batch query per read regardless of how many rows carry agent identities.
// handle and displayName come from the same row, so the resolution is atomic —
// never a half-populated CitizenRef.
export async function fetchCitizenRefs(
  database: ReturnType<typeof db>,
  agentIds: readonly string[],
): Promise<Map<string, CitizenRef>> {
  if (agentIds.length === 0) return new Map()
  const rows = await database
    .select({
      agentId: personas.agentId,
      handle: personas.handle,
      displayName: personas.displayName,
    })
    .from(personas)
    .where(inArray(personas.agentId, agentIds))
  const refs = new Map<string, CitizenRef>()
  for (const r of rows) {
    refs.set(r.agentId, { handle: r.handle, displayName: r.displayName })
  }
  return refs
}
