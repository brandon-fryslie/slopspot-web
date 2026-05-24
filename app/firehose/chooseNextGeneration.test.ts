import { describe, expect, it } from 'vitest'
import type { RecentRecipe } from '~/db/recent'
import { ProviderId, type AspectRatio, type StyleFamily } from '~/lib/domain'
import {
  ASPECT_RATIOS,
  CHOOSER_SUBJECT_TEMPLATE_IDS,
  STYLE_FAMILIES,
  STYLE_FAMILY_PROVIDER_WEIGHTS,
  type ChooserSubjectTemplateId,
} from '~/lib/variety'
import { listProviders } from '~/providers'
import type { GenerationProvider } from '~/providers/types'
import { chooseNextGeneration } from './chooseNextGeneration'

// [LAW:behavior-not-structure] These tests pin the chooser's *contract*:
// every output is a valid recipe in the variety taxonomy, the choice is a
// pure function of (scheduledTimeMs, recent, providers), R1–R6 hold, the
// providers and styles distribute according to the design doc's weights.
// The implementation can be rewritten freely as long as these contracts hold.

const MINUTE = 60 * 1000
const SIX_HOURS = 6 * 60 * MINUTE

// The real registry. Mocks are registered too but have zero weight in
// STYLE_FAMILY_PROVIDER_WEIGHTS, so they're naturally excluded from chooser
// sampling — no test-side filter required.
const ALL_PROVIDERS = listProviders()

function input(scheduledTimeMs: number, recent: readonly RecentRecipe[] = []) {
  return { scheduledTimeMs, recent, providers: ALL_PROVIDERS }
}

function makeRecent(overrides: Partial<RecentRecipe> = {}): RecentRecipe {
  return {
    providerId: ProviderId('fal-flux'),
    styleFamily: 'photoreal',
    subjectTemplate: 'T01',
    slots: { animal: 'cat', profession: 'surgeon' },
    aspectRatio: '1:1',
    ...overrides,
  }
}

describe('chooseNextGeneration — base contract', () => {
  it('is deterministic: same input → same recipe', () => {
    const t = Date.UTC(2026, 5, 17, 12, 0, 0)
    expect(chooseNextGeneration(input(t))).toEqual(chooseNextGeneration(input(t)))
  })

  it('produces valid styleFamily, ChooserSubjectTemplateId, aspectRatio, providerId', () => {
    const t = Date.UTC(2026, 5, 17, 12, 0, 0)
    const r = chooseNextGeneration(input(t))
    expect(STYLE_FAMILIES).toContain(r.styleFamily satisfies StyleFamily)
    expect(CHOOSER_SUBJECT_TEMPLATE_IDS).toContain(
      r.subject.subjectTemplate satisfies ChooserSubjectTemplateId,
    )
    expect(ASPECT_RATIOS).toContain(r.aspectRatio satisfies AspectRatio)
    expect(['fal-flux', 'replicate-sdxl', 'replicate-ideogram']).toContain(r.providerId)
  })

  it('never produces the T00 backfill template (chooser exclusion by type)', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    for (let i = 0; i < 1000; i++) {
      const r = chooseNextGeneration(input(t0 + i * SIX_HOURS))
      expect(r.subject.subjectTemplate).not.toBe('T00')
    }
  })

  it('composes prompt as <subject>, <style seed>', () => {
    const t = Date.UTC(2026, 5, 17, 12, 0, 0)
    const r = chooseNextGeneration(input(t))
    expect(typeof r.prompt).toBe('string')
    expect(r.prompt).toContain(',')
  })

  it('covers all 14 style families given a long enough window', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    const seen = new Set<StyleFamily>()
    for (let i = 0; i < 365 * 4; i++) {
      seen.add(chooseNextGeneration(input(t0 + i * SIX_HOURS)).styleFamily)
    }
    expect(seen.size).toBe(STYLE_FAMILIES.length)
  })

  it('covers all 40 chooser templates given a long enough window', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    const seen = new Set<ChooserSubjectTemplateId>()
    for (let i = 0; i < 365 * 4; i++) {
      seen.add(chooseNextGeneration(input(t0 + i * SIX_HOURS)).subject.subjectTemplate)
    }
    expect(seen.size).toBe(CHOOSER_SUBJECT_TEMPLATE_IDS.length)
  })

  it('handles t=0 and negative scheduledTime without throwing', () => {
    expect(() => chooseNextGeneration(input(0))).not.toThrow()
    expect(() => chooseNextGeneration(input(-MINUTE))).not.toThrow()
  })

  it('produces params that pass the chosen provider paramsSchema', () => {
    const providerById = new Map(ALL_PROVIDERS.map((p) => [p.id, p]))
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    for (let i = 0; i < 200; i++) {
      const r = chooseNextGeneration(input(t0 + i * SIX_HOURS))
      const provider = providerById.get(r.providerId)
      if (!provider) throw new Error(`unknown provider: ${r.providerId}`)
      const parsed = provider.paramsSchema.safeParse(r.params)
      if (!parsed.success) {
        throw new Error(
          `params failed schema for ${r.providerId}: ${parsed.error.message} — params=${JSON.stringify(r.params)}`,
        )
      }
    }
  })
})

describe('chooseNextGeneration — R1 (no consecutive style family)', () => {
  it('never picks the most-recent style family (over many ticks)', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    const recent: RecentRecipe[] = [makeRecent({ styleFamily: 'photoreal' })]
    for (let i = 0; i < 200; i++) {
      const r = chooseNextGeneration(input(t0 + i * SIX_HOURS, recent))
      expect(r.styleFamily).not.toBe('photoreal')
    }
  })
})

describe('chooseNextGeneration — R2 (no repeat subject template in last 5)', () => {
  it('never picks any subject template from the recent-5 window', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    const recent: RecentRecipe[] = [
      makeRecent({ subjectTemplate: 'T01' }),
      makeRecent({ subjectTemplate: 'T02' }),
      makeRecent({ subjectTemplate: 'T03' }),
      makeRecent({ subjectTemplate: 'T04' }),
      makeRecent({ subjectTemplate: 'T05' }),
    ]
    const forbidden = new Set(['T01', 'T02', 'T03', 'T04', 'T05'])
    for (let i = 0; i < 200; i++) {
      const r = chooseNextGeneration(input(t0 + i * SIX_HOURS, recent))
      expect(forbidden.has(r.subject.subjectTemplate)).toBe(false)
    }
  })

  it('only looks at the first 5 entries — older subject templates are unconstrained', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    // T01 is at index 5 (the 6th entry, outside the R2 window)
    const recent: RecentRecipe[] = [
      makeRecent({ subjectTemplate: 'T10' }),
      makeRecent({ subjectTemplate: 'T11' }),
      makeRecent({ subjectTemplate: 'T12' }),
      makeRecent({ subjectTemplate: 'T13' }),
      makeRecent({ subjectTemplate: 'T14' }),
      makeRecent({ subjectTemplate: 'T01' }),
    ]
    let sawT01 = false
    for (let i = 0; i < 1000 && !sawT01; i++) {
      const r = chooseNextGeneration(input(t0 + i * SIX_HOURS, recent))
      if (r.subject.subjectTemplate === 'T01') sawT01 = true
    }
    expect(sawT01).toBe(true)
  })
})

describe('chooseNextGeneration — R3 (provider differs from most recent if ≥2 candidates)', () => {
  it('never picks the most-recent providerId (full registry, 3 candidates)', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    const recent: RecentRecipe[] = [makeRecent({ providerId: ProviderId('fal-flux') })]
    for (let i = 0; i < 200; i++) {
      const r = chooseNextGeneration(input(t0 + i * SIX_HOURS, recent))
      expect(r.providerId).not.toBe('fal-flux')
    }
  })

  it('does not apply R3 when only one provider candidate has nonzero weight', () => {
    // Build a single-real-provider universe — only fal-flux available, mocks have 0 weight.
    const onlyFal = ALL_PROVIDERS.filter((p) => p.id === 'fal-flux')
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    const recent: RecentRecipe[] = [makeRecent({ providerId: ProviderId('fal-flux') })]
    // Even though the most-recent provider is fal-flux, R3 doesn't fire when
    // only one nonzero candidate remains — the chooser must still return
    // something rather than starve.
    const r = chooseNextGeneration({
      scheduledTimeMs: t0,
      recent,
      providers: onlyFal,
    })
    expect(r.providerId).toBe('fal-flux')
  })
})

describe('chooseNextGeneration — R4 (no three-in-a-row aspect ratio)', () => {
  it('rejects the candidate aspect ratio when the last two posts share it', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    const recent: RecentRecipe[] = [
      makeRecent({ aspectRatio: '1:1' }),
      makeRecent({ aspectRatio: '1:1' }),
    ]
    for (let i = 0; i < 200; i++) {
      const r = chooseNextGeneration(input(t0 + i * SIX_HOURS, recent))
      expect(r.aspectRatio).not.toBe('1:1')
    }
  })

  it('allows two-in-a-row (only three-in-a-row is forbidden)', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    const recent: RecentRecipe[] = [makeRecent({ aspectRatio: '1:1' })]
    let saw1x1 = false
    for (let i = 0; i < 500 && !saw1x1; i++) {
      const r = chooseNextGeneration(input(t0 + i * SIX_HOURS, recent))
      if (r.aspectRatio === '1:1') saw1x1 = true
    }
    expect(saw1x1).toBe(true)
  })
})

describe('chooseNextGeneration — R5 (soft downweight repeated style families)', () => {
  it('over a long run with one over-represented style in history, downweights it relative to base rate', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    // Fill recent[1..19] with 'photoreal' (19 instances). recent[0] is a
    // different style so R1 doesn't also forbid 'photoreal' — we want to
    // measure R5 in isolation.
    const recent: RecentRecipe[] = [
      makeRecent({ styleFamily: 'anime' }),
      ...Array.from({ length: 19 }, () => makeRecent({ styleFamily: 'photoreal' })),
    ]
    let photorealCount = 0
    let otherCount = 0
    for (let i = 0; i < 2000; i++) {
      const r = chooseNextGeneration(input(t0 + i * SIX_HOURS, recent))
      if (r.styleFamily === 'photoreal') photorealCount++
      else if (r.styleFamily !== 'anime') otherCount++  // exclude R1-rejected 'anime'
    }
    // 'photoreal' has weight 0.3, other ~12 families have weight 1.0 each.
    // Expected ratio ≈ 0.3 / 12 ≈ 2.5%. So photorealCount / (otherCount/12) ≈ 0.3.
    // Allow plenty of slack on the hash-based "randomness".
    const avgOtherPerFamily = otherCount / 12
    const ratio = photorealCount / avgOtherPerFamily
    expect(ratio).toBeLessThan(0.6)  // would be ≈1.0 without R5
  })
})

describe('chooseNextGeneration — R6 (soft downweight repeated slot values)', () => {
  it('downweights a recently-used slot value relative to fresh vocab items', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    // Stuff `animal: cat` into the recent window heavily.
    const recent: RecentRecipe[] = Array.from({ length: 20 }, () =>
      makeRecent({ subjectTemplate: 'T29', slots: { animal: 'cat' } }),
    )
    // T29 is `a {animal} captured in the act of forgetting`. The chooser
    // can sample any subject template (T29 was used 5+ times so R2
    // rejects it, but the slot value 'cat' bleeds into any template
    // that has an 'animal' slot).
    let catCount = 0
    let otherAnimalCount = 0
    for (let i = 0; i < 2000; i++) {
      const r = chooseNextGeneration(input(t0 + i * SIX_HOURS, recent))
      const animal = (r.subject.slots as Record<string, string>).animal
      if (animal === 'cat') catCount++
      else if (animal !== undefined) otherAnimalCount++
    }
    // With 21 animals in the vocab, 'cat' has weight 0.5, others 1.0.
    // Without R6: cat would be ~1/21 of animal-bearing templates.
    // With R6:   cat should be ~0.5/(0.5 + 20) ≈ 2.4% instead of 4.8%.
    // Test the directional claim: catCount < otherAnimalCount / 20.
    expect(catCount).toBeLessThan(otherAnimalCount / 20)
  })
})

describe('chooseNextGeneration — provider weighting', () => {
  it('respects STYLE_FAMILY_PROVIDER_WEIGHTS — vaporwave (ideogram-primary) picks ideogram more than fal-flux', () => {
    // To isolate provider sampling for a single style, build a stub recent
    // window that forces R1 to keep choosing vaporwave: actually we can't
    // force a style choice; instead, count provider picks across many
    // fires where the style happens to be vaporwave.
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    const providerCounts = new Map<string, number>()
    let vaporwaveFires = 0
    for (let i = 0; i < 20000 && vaporwaveFires < 200; i++) {
      const r = chooseNextGeneration(input(t0 + i * SIX_HOURS))
      if (r.styleFamily === 'vaporwave') {
        vaporwaveFires++
        providerCounts.set(r.providerId, (providerCounts.get(r.providerId) ?? 0) + 1)
      }
    }
    // Vaporwave weights: fal-flux 0.5, sdxl 0.5, ideogram 1.0 → ideogram ≈50%.
    expect(vaporwaveFires).toBeGreaterThan(100)
    const ideoCount = providerCounts.get('replicate-ideogram') ?? 0
    const falCount = providerCounts.get('fal-flux') ?? 0
    // Ideogram has 2x fal's weight for vaporwave; assert ideogram > fal with
    // a soft margin to survive hash variance.
    expect(ideoCount).toBeGreaterThan(falCount)
  })
})

describe('chooseNextGeneration — provider params', () => {
  it('fal-flux params include steps=4', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    for (let i = 0; i < 200; i++) {
      const r = chooseNextGeneration(input(t0 + i * SIX_HOURS))
      if (r.providerId === 'fal-flux') {
        expect((r.params as { steps: number }).steps).toBe(4)
      }
    }
  })

  it('ideogram params include a deterministic seed within ideogram range', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    for (let i = 0; i < 500; i++) {
      const r = chooseNextGeneration(input(t0 + i * SIX_HOURS))
      if (r.providerId === 'replicate-ideogram') {
        const p = r.params as { seed: number; styleType: string; magicPromptOption: string }
        expect(p.seed).toBeGreaterThanOrEqual(0)
        expect(p.seed).toBeLessThanOrEqual(2147483647)
        expect(p.magicPromptOption).toBe('Auto')
        // styleType depends on styleFamily — anime → Anime, etc.
        if (r.styleFamily === 'anime') expect(p.styleType).toBe('Anime')
        if (r.styleFamily === '1990s-cgi') expect(p.styleType).toBe('Render 3D')
        if (r.styleFamily === 'photoreal') expect(p.styleType).toBe('Realistic')
      }
    }
  })

  it('STYLE_FAMILY_PROVIDER_WEIGHTS contains a row for every style family', () => {
    // Surface a missing-table-entry would have caused a 0-weight-pool crash.
    for (const style of STYLE_FAMILIES) {
      expect(STYLE_FAMILY_PROVIDER_WEIGHTS[style]).toBeDefined()
      const nonzero = Object.values(STYLE_FAMILY_PROVIDER_WEIGHTS[style]).filter((w) => w > 0)
      expect(nonzero.length).toBeGreaterThan(0)
    }
  })
})

describe('chooseNextGeneration — config guard', () => {
  it('throws if zero providers are supplied', () => {
    expect(() =>
      chooseNextGeneration({
        scheduledTimeMs: 0,
        recent: [],
        providers: [] as readonly GenerationProvider<unknown>[],
      }),
    ).toThrow()
  })
})
