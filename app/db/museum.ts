// [LAW:decomposition] The museum read ORCHESTRATOR — the one place that zips the crowns
// table (what the city crowned, with its decree) against the feed reader (the crowned
// post's image). Two thin routes (/saints, /rogues) share it, so the zip lives once, not
// twice. It owns no storage: crowns.ts answers "the crowns of these lenses" and feed.ts
// answers "these posts' images"; this module only joins them into the museum's read shape.
//
// [LAW:one-way-deps] museum → crowns, feed, rite, domain, voice. Both lower readers are
// single-enforcers of their own table; this orchestrator inverts neither (it asks each for
// its own data and combines the values), so crowns → feed stays uncrossed.

import { museumCrownings, type MuseumCrowning } from '~/db/crowns'
import { getFeedItemsByIds } from '~/db/feed'
import { lensesInHall, markFor, type HallId } from '~/lib/rite'
import type {
  CitizenRef,
  CrownMark,
  Media,
  PostId,
  RenderablePost,
  RiteLens,
} from '~/lib/domain'
import type { Utterance } from '~/lib/voice'

export type { HallId } from '~/lib/rite'

// [LAW:types-are-the-program] One museum tile, carrying EXACTLY what the hall renders: the
// crowned image, its permalink target (postId), the lens it was crowned under (and that
// lens's eternal mark, the tone the tile wears), the day it settled, the presiding citizen,
// and the Proprietor's decree. A crown whose post is not a settled image (a deleted slop a
// crown still references) yields NO entry — a real absence at the resolve boundary, never a
// blank tile. `media` is narrowed to the image variant, so the tile never reaches into the
// content union itself.
export type MuseumEntry = {
  readonly postId: PostId
  readonly lens: RiteLens
  readonly mark: CrownMark
  readonly riteDay: string
  readonly decree: Utterance
  readonly presiding: CitizenRef
  readonly media: Extract<Media, { kind: 'image' }>
}

// [LAW:types-are-the-program] A whole hall's read result: which hall, and its entries in
// crown order (newest-first, from museumCrownings). `hall` rides through so the component
// renders the right title/voice by value, not a second lookup.
export type MuseumHallData = {
  readonly hall: HallId
  readonly entries: readonly MuseumEntry[]
}

// [LAW:dataflow-not-control-flow] A crown becomes an entry IFF its post resolves to a
// settled image. A null resolution or a non-image post yields the empty array (flatMap
// drops it) — a real absence at the storage-read boundary, mirroring the home loader's
// toContender. No defensive guard hiding a bug: a crown can only ever target a succeeded
// generation (gatherCandidates filters status='succeeded'), so a miss here is a deletion.
function toEntry(c: MuseumCrowning, rp: RenderablePost | null): MuseumEntry[] {
  if (rp === null) return []
  const content = rp.post.content
  if (
    content.kind === 'generation' &&
    content.status.kind === 'succeeded' &&
    content.status.output.kind === 'image'
  ) {
    return [
      {
        postId: c.postId,
        lens: c.lens,
        // [LAW:one-source-of-truth] The tile's tone is markFor(lens), the SAME derivation
        // the feed's eternal mark uses — never a second lens→tone map in the component.
        mark: markFor(c.lens),
        riteDay: c.riteDay,
        decree: c.decree,
        presiding: c.presiding,
        media: content.status.output,
      },
    ]
  }
  return []
}

// [LAW:single-enforcer] The museum's read, end to end. crowns.ts gives the ordered crown
// records of this hall's lenses; feed.ts batch-resolves their posts' images in one pass;
// this zips them by id in the crown order. The lens partition (lensesInHall) is derived
// from the one hall router, so a hall shows exactly its lenses and no crown is orphaned.
export async function loadMuseumHall(
  env: Env,
  hall: HallId,
  voterId?: string,
): Promise<MuseumHallData> {
  const crownings = await museumCrownings(env, lensesInHall(hall))
  const posts = await getFeedItemsByIds(
    env,
    crownings.map((c) => c.postId),
    voterId,
  )
  const entries = crownings.flatMap((c) => toEntry(c, posts.get(c.postId) ?? null))
  return { hall, entries }
}
