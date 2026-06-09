// [LAW:behavior-not-structure] The cursor-pagination CONTRACT of getFeedPage, asserted against a
// real D1 isolate (the keyset, the index seek, the no-skip/no-dupe totality only hold against real
// SQLite ordering — a mock would let them lie). These are blind to the two-phase decomposition; they
// pin only what a caller observes: page through to exhaustion and you see every post exactly once.
//
//   top / new — EXACT totality: the concatenation of pages === a single ORDER BY <mode tuple> over
//     all posts. Same order, no skip, no dupe, every post present. The keyset IS the display order.
//   hot       — NO-DROP and NO-DUPE asserted SEPARATELY (set-equality + length), plus a BOUNDED
//     position error vs the true global hotness order — NOT exact order, because hot SELECTS on the
//     stable created_at axis and RE-SORTS each page by hotness (the §4.2 within-slab approximation).
//
// The EXPLAIN block is the O(K) proof: the phase-1 keyset query SEEKS its index (no full SCAN, no
// TEMP B-TREE for top/new). MEASURED here, not assumed.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { and, sql } from 'drizzle-orm'
import { getFeedPage } from '~/db/feed'
import { setBacking } from '~/db/backings'
import { db } from '~/db/client'
import { posts } from '~/db/schema'
import {
  applySortMode,
  cursorFilter,
  keysetOrderBy,
  windowFilter,
  type SortMode,
} from '~/lib/sort-mode'
import { PostId, AgentId, type Origin } from '~/lib/domain'
import { seedPost, seedVote } from './helpers'

const TOP_ALL: SortMode = { mode: 'top', window: 'all' }
const NEW: SortMode = { mode: 'new' }
const HOT: SortMode = { mode: 'hot' }

// A deterministic gene pool: posts spaced in created_at within the Hot window, with scores that do
// NOT track recency (a non-monotonic pattern), so the three modes produce genuinely DIFFERENT
// orderings and the keyset tie-breaks + the hot re-sort are actually exercised. Two posts share an
// exact created_at to exercise the id tie-break. Returns the seeded ids.
const N = 24
async function seedGenePool(): Promise<string[]> {
  const now = Date.now()
  const ids: string[] = []
  for (let i = 0; i < N; i++) {
    // 2h apart, newest last; all within the 14-day Hot window. Posts i=10 and i=11 collide on
    // created_at (same offset) so the (…, id) tie-break has work to do.
    const offset = (i === 11 ? 10 : i) * 2 * 60 * 60 * 1000
    const id = `pool-${String(i).padStart(2, '0')}`
    await seedPost(env, { id, createdAt: new Date(now - (N * 2 * 60 * 60 * 1000) + offset) })
    // Score in [-3, +4], non-monotonic in i so hotness ≠ pure recency and top ≠ new.
    const score = ((i * 5) % 8) - 3
    const sign: 1 | -1 = score >= 0 ? 1 : -1
    for (let v = 0; v < Math.abs(score); v++) {
      await seedVote(env, { postId: PostId(id), voterId: `v-${i}-${v}`, value: sign })
    }
    ids.push(id)
  }
  return ids
}

// Page through to exhaustion via the opaque nextCursor, returning the ids in the order seen.
async function pageThrough(sort: SortMode, limit: number): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = []
  let cursor: string | null = null
  for (let i = 0; i < 1000; i++) {
    const page = await getFeedPage(env, { sort, limit, cursor })
    ids.push(...page.items.map((it) => it.post.id))
    if (page.nextCursor === null) return { ids, pages: i + 1 }
    cursor = page.nextCursor
  }
  // [LAW:no-silent-fallbacks] A feed that never returns nextCursor=null is a totality bug we WANT
  // to surface loudly, not paper over with a silent cap.
  throw new Error('pageThrough: nextCursor never reached null within 1000 pages')
}

// The ground-truth order for a mode: the SAME ORDER BY getFeedPage's DISPLAY uses, over EVERY post,
// unpaginated. For top/new this is also the keyset order (display === selection). For hot it is the
// true global hotness order the paginated approximation is measured against.
//
// affinity is the literal 0 — the UNBACKED viewer getFeedPage's tests page as. effectiveScore then
// equals posts.score exactly (score + 10*0), so this is simultaneously the lens-free ground truth AND
// a check that the lens degrades to byte-identical order when the viewer backs no one.
async function fullOrder(sort: SortMode): Promise<string[]> {
  const ctx = { score: posts.score, affinity: sql`0`, createdAt: posts.createdAt, id: posts.id }
  const rows = await db(env)
    .select({ id: posts.id })
    .from(posts)
    .orderBy(...applySortMode(sort, ctx))
  return rows.map((r) => r.id)
}

describe('getFeedPage — cursor totality (top/new are EXACT)', () => {
  it('top: paging concatenates to the exact single-query order, no skip, no dupe', async () => {
    const seeded = await seedGenePool()
    const expected = await fullOrder(TOP_ALL)
    const { ids, pages } = await pageThrough(TOP_ALL, 7)

    expect(ids).toEqual(expected) // exact order ⇒ no skip, no dupe, totality, all in one assertion
    expect(new Set(ids).size).toBe(seeded.length) // every seeded post present exactly once
    expect(pages).toBeGreaterThan(1) // the seed actually exercised >1 page (24 posts / 7)
  })

  it('new: paging concatenates to the exact created_at order, no skip, no dupe', async () => {
    const seeded = await seedGenePool()
    const expected = await fullOrder(NEW)
    const { ids } = await pageThrough(NEW, 5)

    expect(ids).toEqual(expected)
    expect(new Set(ids).size).toBe(seeded.length)
  })

  it('top: a different page size yields the identical concatenation (page size is not load-bearing)', async () => {
    await seedGenePool()
    const expected = await fullOrder(TOP_ALL)
    const a = (await pageThrough(TOP_ALL, 3)).ids
    const b = (await pageThrough(TOP_ALL, 13)).ids
    expect(a).toEqual(expected)
    expect(b).toEqual(expected)
  })

  it('the score tie-break holds across a page seam: equal-score posts keep (createdAt, id) order', async () => {
    // Three posts, identical score 0, where a page boundary falls BETWEEN them — the keyset must not
    // skip or repeat at the tie. Seeded oldest→newest with ids chosen so desc(id) is unambiguous.
    await seedPost(env, { id: 'tie-a', createdAt: new Date(Date.now() - 3000) })
    await seedPost(env, { id: 'tie-b', createdAt: new Date(Date.now() - 2000) })
    await seedPost(env, { id: 'tie-c', createdAt: new Date(Date.now() - 1000) })
    const expected = await fullOrder(TOP_ALL)
    const { ids } = await pageThrough(TOP_ALL, 1) // one post per page — every seam is a tie seam
    expect(ids).toEqual(expected)
    expect(new Set(ids).size).toBe(3)
  })
})

describe('getFeedPage — cursor totality (hot: no-drop / no-dupe SEPARATELY + bounded error)', () => {
  it('hot: NO DROP — every seeded post appears across the pages', async () => {
    const seeded = await seedGenePool()
    const { ids } = await pageThrough(HOT, 7)
    // Asserted on its own: the set of paged ids equals the set of all seeded ids.
    expect(new Set(ids)).toEqual(new Set(seeded))
  })

  it('hot: NO DUPE — no post appears twice across the pages', async () => {
    await seedGenePool()
    const { ids } = await pageThrough(HOT, 7)
    // Asserted on its own, independent of drop: ids has no repeats.
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('hot: BOUNDED position error vs the true global hotness order (approximate, not exact)', async () => {
    await seedGenePool()
    const limit = 7
    const paged = (await pageThrough(HOT, limit)).ids
    const trueHot = await fullOrder(HOT)

    // NOTE: this bound is a SEED-SPECIFIC QUALITY measurement, NOT a correctness invariant. The
    // correctness invariants are no-drop and no-dupe, asserted separately above; hot's display order
    // is a BY-DESIGN approximation (its true f(score, created_at) order is not cursorable, so it
    // keysets created_at and re-sorts each page by hotness). With this seed (scores 0–4) hotness ≈
    // recency so displacement is ~0; at prod scores (~214+) the score term can exceed a page's
    // created_at spread and displacement WOULD exceed `limit` — that is acceptable approximation, not
    // a regression. Do not read this as a correctness assertion.
    //
    // The bound here: hot SELECTS by created_at in pages of `limit` then re-sorts each page by
    // hotness, so for this low-score seed a post sits within one page of its global-hotness rank.
    const pagedPos = new Map(paged.map((id, i) => [id, i]))
    let maxDisplacement = 0
    for (let i = 0; i < trueHot.length; i++) {
      maxDisplacement = Math.max(maxDisplacement, Math.abs(pagedPos.get(trueHot[i])! - i))
    }
    // MEASURED, then asserted: the displacement stays within a page. (Logged so a regression that
    // widens it is visible, not just a pass/fail.)
    console.log(`[hot bounded-error] maxDisplacement=${maxDisplacement} limit=${limit} N=${trueHot.length}`)
    expect(maxDisplacement).toBeLessThanOrEqual(limit)
  })

  it('hot: each emitted page is internally hotness-sorted (the within-slab re-sort happened)', async () => {
    await seedGenePool()
    // Pull one page and confirm its items are in non-increasing hotness — proves the re-sort ran,
    // distinguishing hot from new (which would be pure created_at order).
    const page = await getFeedPage(env, { sort: HOT, limit: 10 })
    const order = await fullOrder(HOT)
    const rank = new Map(order.map((id, i) => [id, i]))
    const pageRanks = page.items.map((it) => rank.get(it.post.id)!)
    const sorted = [...pageRanks].sort((a, b) => a - b)
    expect(pageRanks).toEqual(sorted) // the page follows global hotness order among its members
  })
})

describe('getFeedPage — end-of-feed signal', () => {
  it('nextCursor is null exactly when the last page is short', async () => {
    await seedGenePool() // 24 posts
    const page1 = await getFeedPage(env, { sort: NEW, limit: 24 })
    // A full page (24 of 24) cannot KNOW it is the last, so it still offers a cursor…
    expect(page1.items).toHaveLength(24)
    expect(page1.nextCursor).not.toBeNull()
    // …and following it yields an empty final page with a null cursor — the honest terminator.
    const page2 = await getFeedPage(env, { sort: NEW, limit: 24, cursor: page1.nextCursor })
    expect(page2.items).toHaveLength(0)
    expect(page2.nextCursor).toBeNull()
  })

  it('a short first page (fewer than limit) terminates immediately', async () => {
    await seedPost(env, { id: 'lonely', createdAt: new Date() })
    const page = await getFeedPage(env, { sort: NEW, limit: 12 })
    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toBeNull()
  })

  it('an empty feed is one empty page with a null cursor', async () => {
    const page = await getFeedPage(env, { sort: HOT, limit: 12 })
    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeNull()
  })
})

describe('getFeedPage — cursor trust boundary (degrade to page 1, never throw)', () => {
  it('a garbage cursor serves page 1 (no throw)', async () => {
    await seedGenePool()
    const page1 = await getFeedPage(env, { sort: NEW, limit: 5 })
    const garbage = await getFeedPage(env, { sort: NEW, limit: 5, cursor: '!!!not-a-cursor!!!' })
    expect(garbage.items.map((i) => i.post.id)).toEqual(page1.items.map((i) => i.post.id))
  })

  it('a cursor built for a different sort is ignored (mode mismatch → page 1)', async () => {
    await seedGenePool()
    // Take a real NEW cursor, then hand it to a TOP request: it must be rejected, not misapplied.
    const newPage = await getFeedPage(env, { sort: NEW, limit: 5 })
    const topPage1 = await getFeedPage(env, { sort: TOP_ALL, limit: 5 })
    const crossed = await getFeedPage(env, { sort: TOP_ALL, limit: 5, cursor: newPage.nextCursor })
    expect(crossed.items.map((i) => i.post.id)).toEqual(topPage1.items.map((i) => i.post.id))
  })
})

describe('getFeedPage — EXPLAIN QUERY PLAN (the O(K) keyset seek, MEASURED)', () => {
  // Reconstruct phase-1 EXACTLY as getFeedPage builds it (same public sort-mode helpers), WITH a
  // cursor so the plan shows a SEEK, then EXPLAIN the real SQL. Asserts the contract AND prints the
  // plan for the review record.
  async function explainKeyset(sort: SortMode, cursorPayload: Parameters<typeof cursorFilter>[0]): Promise<string> {
    const ctx = { score: posts.score, createdAt: posts.createdAt, id: posts.id }
    const q = db(env)
      .select({ id: posts.id, score: posts.score, createdAt: posts.createdAt })
      .from(posts)
      .where(and(windowFilter(sort, posts.createdAt, Date.now()), cursorFilter(cursorPayload, ctx)))
      .orderBy(...keysetOrderBy(sort, ctx))
      .limit(7)
    const { sql, params } = q.toSQL()
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...params)
      .all<{ detail: string }>()
    const detail = plan.results.map((r) => r.detail).join(' | ')
    console.log(`[EXPLAIN ${sort.mode}${sort.mode === 'top' ? '/' + sort.window : ''}] ${detail}`)
    return detail
  }

  it('top: SEARCHes posts_score_created_idx (seek), no full SCAN, no TEMP B-TREE', async () => {
    await seedGenePool()
    const detail = await explainKeyset(TOP_ALL, { m: 'top', s: 1, t: Date.now(), id: 'pool-12' })
    expect(detail).toContain('SEARCH') // a seek to the cursor, not a SCAN+filter — O(K) not O(depth)
    expect(detail).toContain('USING COVERING INDEX posts_score_created_idx')
    expect(detail).not.toContain('TEMP B-TREE') // ORDER BY served by the index, not a sort
  })

  it('new: SEARCHes the (created_at, id) index (seek), no full SCAN, no TEMP B-TREE', async () => {
    await seedGenePool()
    const detail = await explainKeyset(NEW, { m: 'new', t: Date.now(), id: 'pool-12' })
    expect(detail).toContain('SEARCH')
    // SEEKs the composite index. "USING INDEX" (not COVERING) because the candidate query also reads
    // score (for top's cursor) which isn't in this index — an O(K) row fetch, not an O(depth) scan.
    expect(detail).toMatch(/USING (COVERING )?INDEX posts_created_at_id_idx/)
    expect(detail).not.toContain('TEMP B-TREE') // the id tie-break is IN the composite index
  })

  it('hot: SEARCHes the (created_at, id) index (seek) — no TEMP B-TREE (hotness re-sort is in the page hydration)', async () => {
    await seedGenePool()
    const detail = await explainKeyset(HOT, { m: 'hot', t: Date.now(), id: 'pool-12' })
    expect(detail).toContain('SEARCH')
    expect(detail).toContain('posts_created_at_id_idx')
    expect(detail).not.toContain('TEMP B-TREE') // hot keysets created_at, never sorts by hotness here
  })
})

// [LAW:behavior-not-structure] The within-page backing lens (the-roll-call.md, roll-call-47p.7). The
// global lens from roll-call-47p.4 was deleted by E1 Fix B; this is its reinstatement under cursor
// pagination, with a DIFFERENT contract these tests pin: a backed critic's votes reorder the slab
// WITHIN each fetched page, NEVER across the page boundary (Phase 1 selects on the bare score for
// every viewer), and a viewer who backs no one sees the byte-identical lens-free feed.
describe('getFeedPage — within-page backing lens (roll-call-47p.7)', () => {
  // A citizen the backing edge can reference (backings.citizen FK → personas.agent_id), seeded the
  // way setBacking reads it. The critic's VOTES are what the lens aggregates (Σ votes by backed
  // citizens), so the critic also casts votes below.
  async function seedCritic(agentId: string, handle: string): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO personas (agent_id, handle, display_name, role, persona_prompt, model_id, config_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(agentId, handle, `Test ${handle}`, 'voter', 'p', 'm', '{}', 0)
      .run()
  }

  const BACKER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' // a human cookie who backs the critic
  const PLAIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' // a human cookie who backs no one
  const CRITIC = 'agent:test-critic'

  // Four posts, distinct bare scores A>B>C>D, distinct created_at so the score axis alone decides the
  // unbacked order. The critic up-votes the LOWEST-score post D (its +1 is already inside D's score);
  // for a viewer backing the critic, D's effectiveScore = score + BACKING_WEIGHT*1 jumps it to the top.
  async function seedLensFixture(): Promise<void> {
    await seedCritic(CRITIC, 'test-critic')
    const base = new Date('2026-03-01T00:00:00Z').getTime()
    const mk = async (id: string, score: number, ageRank: number) => {
      await seedPost(env, { id, createdAt: new Date(base - ageRank * 60_000) })
      // `score` plain up-votes from distinct non-backed voters.
      for (let v = 0; v < score; v++) {
        await seedVote(env, { postId: PostId(id), voterId: `plain-${id}-${v}`, value: 1 })
      }
    }
    await mk('lens-A', 10, 0)
    await mk('lens-B', 8, 1)
    await mk('lens-C', 6, 2)
    // D: 3 plain up-votes PLUS the critic's up-vote → bare score 4, affinity(for a critic-backer) = +1.
    await seedPost(env, { id: 'lens-D', createdAt: new Date(base - 3 * 60_000) })
    for (let v = 0; v < 3; v++) {
      await seedVote(env, { postId: PostId('lens-D'), voterId: `plain-lens-D-${v}`, value: 1 })
    }
    await seedVote(env, { postId: PostId('lens-D'), voterId: CRITIC, value: 1 })
  }

  it('a backed critic re-ranks the slab toward its taste — WITHIN the page, never across it', async () => {
    await seedLensFixture()
    await setBacking({ handle: 'test-critic', voterId: BACKER, backed: true }, { env })

    // limit 2 ⇒ page 1 = the two highest BARE scores {A(10), B(8)} for EVERY viewer (Phase 1 is the
    // bare-score keyset). The critic's lift on D cannot pull it onto page 1 — that is the within-page
    // boundedness, the honest weakness of option A made into a positive contract.
    const plainP1 = await getFeedPage(env, { sort: TOP_ALL, voterId: PLAIN, limit: 2 })
    const backerP1 = await getFeedPage(env, { sort: TOP_ALL, voterId: BACKER, limit: 2 })
    expect(plainP1.items.map((i) => i.post.id)).toEqual(['lens-A', 'lens-B'])
    expect(backerP1.items.map((i) => i.post.id)).toEqual(['lens-A', 'lens-B']) // membership AND order unchanged (no critic vote on either)
    expect(backerP1.nextCursor).toBe(plainP1.nextCursor) // the cursor boundary is Phase-1, viewer-independent

    // Page 2 holds {C(6), D(4)}. Unbacked: by score ⇒ [C, D]. Backer: effectiveScore(D)=4+10=14 >
    // effectiveScore(C)=6 ⇒ [D, C]. The lens reorders the page it landed on.
    const plainP2 = await getFeedPage(env, { sort: TOP_ALL, voterId: PLAIN, limit: 2, cursor: plainP1.nextCursor })
    const backerP2 = await getFeedPage(env, { sort: TOP_ALL, voterId: BACKER, limit: 2, cursor: backerP1.nextCursor })
    expect(plainP2.items.map((i) => i.post.id)).toEqual(['lens-C', 'lens-D'])
    expect(backerP2.items.map((i) => i.post.id)).toEqual(['lens-D', 'lens-C']) // the within-page re-rank
  })

  it('the displayed score stays the pure SUM(votes) — the lens biases ORDER only, never the number', async () => {
    await seedLensFixture()
    await setBacking({ handle: 'test-critic', voterId: BACKER, backed: true }, { env })
    const backerP2 = await getFeedPage(env, { sort: TOP_ALL, voterId: BACKER, limit: 2, cursor: (await getFeedPage(env, { sort: TOP_ALL, voterId: BACKER, limit: 2 })).nextCursor })
    const d = backerP2.items.find((i) => i.post.id === 'lens-D')
    expect(d?.score).toBe(4) // 3 plain + 1 critic = 4, NOT 14 — effectiveScore never leaks into the shown score
  })

  it('a viewer who backs no one sees the byte-identical lens-free order', async () => {
    await seedLensFixture()
    // No backing for PLAIN. The full single-page order must equal fullOrder (affinity=0 ground truth).
    const expected = await fullOrder(TOP_ALL)
    const page = await getFeedPage(env, { sort: TOP_ALL, voterId: PLAIN, limit: 10 })
    expect(page.items.map((i) => i.post.id)).toEqual(expected)
  })

  it('backing then withdrawing restores the plain order — the lens is a live, reversible value', async () => {
    await seedLensFixture()
    const plainOrder = (await getFeedPage(env, { sort: TOP_ALL, voterId: BACKER, limit: 10 })).items.map((i) => i.post.id)

    await setBacking({ handle: 'test-critic', voterId: BACKER, backed: true }, { env })
    const backedOrder = (await getFeedPage(env, { sort: TOP_ALL, voterId: BACKER, limit: 10 })).items.map((i) => i.post.id)
    expect(backedOrder).not.toEqual(plainOrder) // the lens did something

    await setBacking({ handle: 'test-critic', voterId: BACKER, backed: false }, { env })
    const restored = (await getFeedPage(env, { sort: TOP_ALL, voterId: BACKER, limit: 10 })).items.map((i) => i.post.id)
    expect(restored).toEqual(plainOrder) // withdrawing the pledge restores the normal feed by data
  })
})

// [LAW:behavior-not-structure] Maker-authorship affinity (the-roll-call.md §"Backing a citizen",
// roll-call-xgi). The sibling suite above pins the lens for a backed CRITIC, whose VOTES move the slab.
// This pins the other half of the same promise: a backed MAKER's authored work surfaces even with ZERO
// critic votes on it — because authorship is the maker's implicit vote on his own work, +1 into the SAME
// affinity sum at the SAME weight. "Back GutterMonk and the stark devotional work surfaces." A maker
// carries no votes from himself, so without this term his work could never rise; the contract here is
// that backing a maker is exactly as potent as backing a critic.
describe('getFeedPage — maker-authorship affinity (roll-call-xgi)', () => {
  // A generator persona the backing edge can reference (backings.citizen FK → personas.agent_id) and
  // that authors slops (origin_json `$.author.agentId`, what principalExpr('author') reads).
  async function seedMaker(agentId: string, handle: string): Promise<void> {
    await env.DB.prepare(
      `INSERT INTO personas (agent_id, handle, display_name, role, persona_prompt, model_id, config_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(agentId, handle, `Test ${handle}`, 'generator', 'p', 'm', '{}', 0)
      .run()
  }

  const BACKER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' // a human cookie who backs the maker
  const MAKER = 'agent:test-maker'
  const makerOrigin: Origin = { kind: 'authored', author: { kind: 'agent', agentId: AgentId(MAKER) } }

  // Four posts, distinct bare scores A>B>C>D, distinct created_at so the score axis alone decides the
  // unbacked order. A/B/C are authored by an UN-backed citizen (the seed default). D — the LOWEST score
  // — is authored by the backed MAKER and carries NO vote from him. For a viewer backing the maker, D's
  // effectiveScore = score + BACKING_WEIGHT*1 (authorship) jumps it to the top of its page, purely on
  // authorship: the exact "stark devotional work surfaces" the critic's vote-based lens cannot deliver.
  async function seedMakerFixture(): Promise<void> {
    await seedMaker(MAKER, 'test-maker')
    const base = new Date('2026-04-01T00:00:00Z').getTime()
    const mk = async (id: string, score: number, ageRank: number, origin?: Origin) => {
      await seedPost(env, { id, createdAt: new Date(base - ageRank * 60_000), ...(origin ? { origin } : {}) })
      for (let v = 0; v < score; v++) {
        await seedVote(env, { postId: PostId(id), voterId: `plain-${id}-${v}`, value: 1 })
      }
    }
    await mk('mk-A', 10, 0)
    await mk('mk-B', 8, 1)
    await mk('mk-C', 6, 2)
    // D: 4 plain up-votes, authored by the backed maker, ZERO votes from the maker himself.
    await mk('mk-D', 4, 3, makerOrigin)
  }

  it("a backed maker's work surfaces on authorship alone — no critic vote required, WITHIN the page", async () => {
    await seedMakerFixture()
    await setBacking({ handle: 'test-maker', voterId: BACKER, backed: true }, { env })

    // limit 2 ⇒ page 1 = {A(10), B(8)} for EVERY viewer (Phase-1 bare-score keyset). Authorship cannot
    // pull D across the page boundary — within-page boundedness, identical to the critic lens.
    const backerP1 = await getFeedPage(env, { sort: TOP_ALL, voterId: BACKER, limit: 2 })
    expect(backerP1.items.map((i) => i.post.id)).toEqual(['mk-A', 'mk-B'])

    // Page 2 holds {C(6), D(4)}. Unbacked: by score ⇒ [C, D]. Backing the maker: effectiveScore(D) =
    // 4 + 10*1 = 14 > effectiveScore(C) = 6 ⇒ [D, C]. The lift is pure authorship — D has no maker vote.
    const backerP2 = await getFeedPage(env, { sort: TOP_ALL, voterId: BACKER, limit: 2, cursor: backerP1.nextCursor })
    expect(backerP2.items.map((i) => i.post.id)).toEqual(['mk-D', 'mk-C'])
    const d = backerP2.items.find((i) => i.post.id === 'mk-D')
    expect(d?.score).toBe(4) // effectiveScore never leaks into the shown score — order only, never the number
  })

  it('a viewer who backs no one sees the byte-identical lens-free order even with maker-authored posts', async () => {
    await seedMakerFixture()
    const expected = await fullOrder(TOP_ALL)
    const page = await getFeedPage(env, { sort: TOP_ALL, voterId: BACKER, limit: 10 })
    expect(page.items.map((i) => i.post.id)).toEqual(expected) // unbacked: authorship term is 0 by data
  })

  it('authorship and a backed vote STACK in one sum — the whole entourage agreeing tops the slab', async () => {
    // The maker is ALSO a citizen who can vote (a generator persona can carry a vote row). Back the maker
    // and have him both author D AND up-vote it: effectiveScore(D) = score + 10*(1 author + 1 vote). One
    // sum, both terms — the design's "stacking falls out for free."
    await seedMakerFixture()
    await seedVote(env, { postId: PostId('mk-D'), voterId: MAKER, value: 1 }) // D bare score now 5
    await setBacking({ handle: 'test-maker', voterId: BACKER, backed: true }, { env })

    // Page 2 = {C(6), D(5)}. effectiveScore(D) = 5 + 10*(authorship 1 + maker-vote 1) = 25 > C's 6 ⇒ [D, C].
    const p1 = await getFeedPage(env, { sort: TOP_ALL, voterId: BACKER, limit: 2 })
    const p2 = await getFeedPage(env, { sort: TOP_ALL, voterId: BACKER, limit: 2, cursor: p1.nextCursor })
    expect(p2.items.map((i) => i.post.id)).toEqual(['mk-D', 'mk-C'])
    expect(p2.items.find((i) => i.post.id === 'mk-D')?.score).toBe(5) // 4 plain + 1 maker = 5, never 25
  })
})
