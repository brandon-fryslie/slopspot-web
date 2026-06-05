// [LAW:one-source-of-truth] The DERIVED read of a feud standing — the relationship between two citizens
// read from their shared vote history the way score is read as SUM(votes) (slopspot-voice-w2v.2). There
// is NO stored feud status and NO feud edge table: the standing is a pure function of the acts (the votes
// both citizens cast on the same slops), classified by the pure `stanceOf` in app/lib/feud.ts. The named
// rivalries (the-cast.md) EMERGE from this read; they are not duplicated as state.

import { and, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { DB } from '~/db/client'
import { votes } from '~/db/schema'
import { stanceOf, type FeudStanding } from '~/lib/feud'

// [LAW:single-enforcer] The ONE derivation of a citizen-to-citizen standing. A self-join of the votes
// table on the shared slop yields every post BOTH citizens judged; the disposition is the vote's sign
// (blessed=+1 / buried=-1, the votes_value_shape CHECK guarantees ±1). A pair OPPOSES when the signs
// differ and ALIGNS when they match — the magnitude of the feud and the lean of the standing, both
// folded in one aggregate. `lastClashAt` is the most recent opposing pair (the later of the two votes),
// the recency hook .3 (Character With a Past) tints future voice onto. Symmetric by construction:
// standing(x,y) and standing(y,x) count the same pairs.
export async function feudStandingBetween(
  database: DB,
  citizenX: string,
  citizenY: string,
): Promise<FeudStanding> {
  const mine = alias(votes, 'mine')
  const theirs = alias(votes, 'theirs')
  const rows = await database
    .select({
      opposing: sql<number>`coalesce(sum(case when ${mine.value} <> ${theirs.value} then 1 else 0 end), 0)`,
      aligned: sql<number>`coalesce(sum(case when ${mine.value} = ${theirs.value} then 1 else 0 end), 0)`,
      // The later of the two votes in each opposing pair, maxed across pairs — null when they never clash.
      lastClashAt: sql<number | null>`max(case when ${mine.value} <> ${theirs.value} then max(${mine.createdAt}, ${theirs.createdAt}) end)`,
    })
    .from(mine)
    .innerJoin(theirs, eq(theirs.postId, mine.postId))
    .where(and(eq(mine.voterId, citizenX), eq(theirs.voterId, citizenY)))

  // The aggregate is always exactly one row (coalesce pins the sums to 0 over an empty join), so this is
  // a total read, never an absence to guard. [LAW:no-defensive-null-guards]
  const { opposing, aligned, lastClashAt } = rows[0]
  return {
    opposing,
    aligned,
    lastClashAt: lastClashAt === null ? null : new Date(lastClashAt),
    stance: stanceOf(opposing, aligned),
  }
}
