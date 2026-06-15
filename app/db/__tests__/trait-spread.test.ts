// [LAW:no-silent-failure][LAW:verifiable-goals] The breadth directive's PROOF on real-shaped data. The
// [metric]→VictoriaMetrics puller does NOT exist yet (efficiency-a5w.7), so the spread emit reaches
// Workers Logs but no dashboard — a metric is not evidence until something collects it. This suite is the
// evidence: it seeds generation posts whose traits are scattered from the REAL production generator
// centers (the same founder sampler the firehose uses), applies two selection models via real votes/score,
// reads them back through the SAME direct D1 path the daily ceremony uses, and proves the metric detects
// whether selection is eating the range. The numbers it logs are the headline the CD reviews.
//
// [LAW:behavior-not-structure] It pins the OUTCOME — survivors keep the range (healthy) vs survivors lose
// the void pole (collapse) — not the query plan or the stddev formula.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { PostId, type TraitVector } from '~/lib/domain'
import { founderTraits } from '~/lib/founder-traits'
import { readScoredGenerationTraits } from '~/db/trait-spread'
import { buildSpreadReport, isCollapsing } from '~/lib/trait-spread'
import { seedPost, seedVote } from './helpers'

// The REAL production generator centers (migration 0036). Hardcoded here because the workers test pool
// runs in workerd (no node:fs to read the .sql); app/lib/__tests__/founder-traits.test.ts is the AUTHORITY
// that pins these exact numbers to 0036, so a CD retune that drifts them fails THERE, loud.
const GUTTERMONK_VOID: TraitVector = { austerity: 0.12, curse: 0.22, density: 0.1, earnestness: 0.8 }
const IDRIS_MID: TraitVector = { austerity: 0.4, curse: 0.62, density: 0.52, earnestness: 0.25 }
const VESPER_BAROQUE: TraitVector = { austerity: 0.92, curse: 0.8, density: 0.95, earnestness: 0.88 }

const PER_CENTER = 10

type Founder = { id: PostId; traits: TraitVector }

// Seed PER_CENTER founders scattered from each center via the real sampler — the generated cohort then
// SPANS the void axes exactly as the live makers do. Distinct seeds give within-region texture.
async function seedFounders(label: string, center: TraitVector): Promise<Founder[]> {
  const out: Founder[] = []
  for (let i = 0; i < PER_CENTER; i++) {
    const traits = founderTraits(center, (i + 1) * 2654435761)
    const id = await seedPost(env, {
      id: `ts-${label}-${i}`,
      content: { kind: 'generation', traits },
    })
    out.push({ id, traits })
  }
  return out
}

// Give a post a positive score by casting n upvotes from distinct voters (PK is (post_id, voter_id)).
// Unscored posts keep score 0 — so the scored set IS the top-ranked surviving cohort.
async function upvote(id: PostId, n: number): Promise<void> {
  for (let k = 0; k < n; k++) {
    await seedVote(env, { postId: id, voterId: `ts-voter-${id}-${k}`, value: 1 })
  }
}

describe('trait-spread direct D1 read - the surviving-range proof', () => {
  it('HEALTHY: survivors selected independent of pole keep the void range wide', async () => {
    const [void_, mid, baroque] = await Promise.all([
      seedFounders('void', GUTTERMONK_VOID),
      seedFounders('mid', IDRIS_MID),
      seedFounders('baroque', VESPER_BAROQUE),
    ])
    // Promote a pole-SPANNING slice (4 void + 3 mid + 3 baroque = 10 = the top third of 30) so survival
    // is NOT a function of the void axes — the healthy "selection doesn't punish the austere" world.
    for (const f of void_.slice(0, 4)) await upvote(f.id, 3)
    for (const f of mid.slice(0, 3)) await upvote(f.id, 3)
    for (const f of baroque.slice(0, 3)) await upvote(f.id, 3)

    const report = buildSpreadReport(await readScoredGenerationTraits(env))
    console.log('[trait-spread][HEALTHY]', JSON.stringify(report, null, 2))

    expect(report.counts.generated).toBe(30)
    expect(report.counts.surviving).toBe(10)
    expect(isCollapsing(report)).toBe(false)
    // Survivors retain most of the makers' void-axis range.
    expect(report.retention.austerity).toBeGreaterThan(0.6)
    expect(report.retention.density).toBeGreaterThan(0.6)
  })

  it('COLLAPSE: baroque-favouring selection eats the void range — FLAGGED with numbers', async () => {
    // void + mid are seeded only to populate the generated cohort (the makers' full range); the
    // empty slots skip binding them since the collapse model promotes ONLY the baroque pieces.
    const [, , baroque] = await Promise.all([
      seedFounders('void', GUTTERMONK_VOID),
      seedFounders('mid', IDRIS_MID),
      seedFounders('baroque', VESPER_BAROQUE),
    ])
    // The feared world: every baroque piece rises, the austere/sparse void pieces sink to score 0.
    for (const f of baroque) await upvote(f.id, 3)

    const report = buildSpreadReport(await readScoredGenerationTraits(env))
    console.log('[trait-spread][COLLAPSE]', JSON.stringify(report, null, 2))

    expect(report.counts.generated).toBe(30)
    expect(report.counts.surviving).toBe(10)
    // The makers DID produce the void range...
    expect(report.spread.generated.austerity).toBeGreaterThan(0.2)
    expect(report.spread.generated.density).toBeGreaterThan(0.2)
    // ...and selection has eaten it: the surviving cohort collapsed toward the baroque pole.
    expect(isCollapsing(report)).toBe(true)
    expect(report.retention.austerity).toBeLessThan(0.5)
    expect(report.retention.density).toBeLessThan(0.5)
  })
})
