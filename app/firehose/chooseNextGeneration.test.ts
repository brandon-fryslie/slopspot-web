import { beforeAll, describe, expect, it } from 'vitest'
import type { RecentRecipe } from '~/db/recent'
import { ProviderId, type AspectRatio, type StyleFamily } from '~/lib/domain'
import {
  ASPECT_RATIOS,
  CHOOSER_SUBJECT_TEMPLATE_IDS,
  STYLE_FAMILIES,
  type ChooserSubjectTemplateId,
} from '~/lib/variety'
import { getProvider } from '~/providers'
import type { GenerationProvider } from '~/providers/types'
import {
  chooseNextGeneration,
  type ChooserOutput,
} from './chooseNextGeneration'

// [LAW:behavior-not-structure] These tests pin the chooser's *contract*:
// every output is a valid recipe in the variety taxonomy, the choice is a pure
// function of (scheduledTimeMs, recent, provider), R1/R2/R4/R5/R6 hold, and the
// aspect draw is gated to what the provider serves. [RECONCILE C] The provider is
// no longer chosen by the chooser — it is the author-persona's MEDIUM, passed in.
// So `providerId` simply echoes the input, and there is no R3 (provider rotation).

const MINUTE = 60 * 1000
const SIX_HOURS = 6 * 60 * MINUTE

// fal-flux supports every aspect ratio, so it does not constrain the aspect-draw
// tests below. A restricted stub is used separately to pin the gating contract.
const PROVIDER = getProvider(ProviderId('fal-flux'))

function input(scheduledTimeMs: number, recent: readonly RecentRecipe[] = []) {
  return { scheduledTimeMs, recent, provider: PROVIDER }
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
    expect(r.providerId).toBe('fal-flux')
  })

  it('never produces the T00 backfill template (chooser exclusion by type)', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    for (let i = 0; i < 1000; i++) {
      const r = chooseNextGeneration(input(t0 + i * SIX_HOURS))
      expect(r.subject.subjectTemplate).not.toBe('T00')
    }
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

  it('exposes paramsSeed as a non-negative integer for the caller to build provider params', () => {
    const t = Date.UTC(2026, 5, 17, 12, 0, 0)
    const r = chooseNextGeneration(input(t))
    expect(Number.isInteger(r.paramsSeed)).toBe(true)
    expect(r.paramsSeed).toBeGreaterThanOrEqual(0)
  })
})

// [RECONCILE C] The provider is the persona's medium — the chooser stamps it onto
// every recipe verbatim, never picks among alternatives.
describe('chooseNextGeneration — provider is the persona medium (not chosen)', () => {
  it('providerId echoes the input provider, every fire', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    const sdxl = getProvider(ProviderId('replicate-sdxl'))
    for (let i = 0; i < 200; i++) {
      const r = chooseNextGeneration({ scheduledTimeMs: t0 + i * SIX_HOURS, recent: [], provider: sdxl })
      expect(r.providerId).toBe('replicate-sdxl')
    }
  })

  it('gates the aspect draw to the provider.supportedAspectRatios', () => {
    // A medium that only serves square + landscape — the chooser must never
    // hand it an unsupported ratio.
    const supported: readonly AspectRatio[] = ['1:1', '16:9']
    const restricted = {
      ...PROVIDER,
      id: ProviderId('restricted-stub'),
      supportedAspectRatios: supported,
    } as GenerationProvider<unknown>
    const allowed = new Set<AspectRatio>(supported)
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    for (let i = 0; i < 500; i++) {
      const r = chooseNextGeneration({ scheduledTimeMs: t0 + i * SIX_HOURS, recent: [], provider: restricted })
      expect(allowed.has(r.aspectRatio)).toBe(true)
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

// [LAW:behavior-not-structure] The sustained-chain AC — "N successive cron fires
// honor the anti-rep rules and the variety distribution" — is verifiable in pure
// code: the chooser is pure, so threading `recent` forward across N iterations is
// structurally equivalent to N cron fires without the I/O cost. R1/R2/R4 are hard
// rejections that must hold EVERY iteration.
describe('chooseNextGeneration — sustained chain', () => {
  const N = 1000
  const BASE_T = Date.UTC(2026, 0, 1, 0, 0, 0)
  const R6_WINDOW = 20

  function runChain(): ChooserOutput[] {
    const out: ChooserOutput[] = []
    let recent: RecentRecipe[] = []
    for (let i = 0; i < N; i++) {
      const t = BASE_T + i * SIX_HOURS
      const r = chooseNextGeneration({ scheduledTimeMs: t, recent, provider: PROVIDER })
      out.push(r)
      const stored: RecentRecipe = {
        providerId: r.providerId,
        styleFamily: r.styleFamily,
        subjectTemplate: r.subject.subjectTemplate,
        slots: r.subject.slots as Record<string, string>,
        aspectRatio: r.aspectRatio,
      }
      recent = [stored, ...recent].slice(0, R6_WINDOW)
    }
    return out
  }

  let chain: ChooserOutput[]
  beforeAll(() => {
    chain = runChain()
  })

  it(`R1: never two consecutive same style_family across ${N} fires`, () => {
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i]!.styleFamily).not.toBe(chain[i - 1]!.styleFamily)
    }
  })

  it(`R2: never a subject_template that appeared in the previous 5 fires`, () => {
    for (let i = 5; i < chain.length; i++) {
      const recent5 = new Set(
        [1, 2, 3, 4, 5].map((k) => chain[i - k]!.subject.subjectTemplate),
      )
      expect(recent5.has(chain[i]!.subject.subjectTemplate)).toBe(false)
    }
  })

  it(`R4: never three consecutive same aspect_ratio`, () => {
    for (let i = 2; i < chain.length; i++) {
      const a = chain[i]!.aspectRatio
      const b = chain[i - 1]!.aspectRatio
      const c = chain[i - 2]!.aspectRatio
      const allMatch = a === b && b === c
      expect(allMatch).toBe(false)
    }
  })

  it('distribution: every style family appears at least once across the chain', () => {
    const seen = new Set(chain.map((r) => r.styleFamily))
    expect(seen.size).toBe(STYLE_FAMILIES.length)
  })

  it('distribution: aspect-ratio bias materializes — `cyberpunk-neon` skews 16:9 vs 9:16', () => {
    // cyberpunk-neon has STYLE_FAMILY_ASPECT_BIAS = { '16:9': 1.5, '4:3': 1.5 }.
    // Base weights: 16:9 = 20, 9:16 = 15 → biased 30 vs 15 → 2× ratio.
    const cyber = chain.filter((r) => r.styleFamily === 'cyberpunk-neon')
    expect(cyber.length).toBeGreaterThanOrEqual(30)
    const land16 = cyber.filter((r) => r.aspectRatio === '16:9').length
    const port9 = cyber.filter((r) => r.aspectRatio === '9:16').length
    // R4 perturbs this but the bias should still produce land16 > port9.
    expect(land16).toBeGreaterThan(port9)
  })
})

// [LAW:behavior-not-structure] Persona bias tests assert the *contract* of bias
// injection: absent bias = all-ones (regression guard), strong bias = measurable
// skew, promptPrefix carried by the caller. [RECONCILE C] No providerBias — the
// provider is the medium, not a biased draw.
describe('chooseNextGeneration — persona bias', () => {
  const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)

  it('absent bias produces identical output to empty bias (regression guard)', () => {
    for (let i = 0; i < 100; i++) {
      const t = t0 + i * SIX_HOURS
      const withoutBias = chooseNextGeneration({ scheduledTimeMs: t, recent: [], provider: PROVIDER })
      const withEmptyBias = chooseNextGeneration({ scheduledTimeMs: t, recent: [], provider: PROVIDER, bias: {} })
      expect(withoutBias).toEqual(withEmptyBias)
    }
  })

  it('styleFamilyBias upweight pushes distribution toward that style', () => {
    // Strong bias toward 'photoreal' should make it appear far more often
    // than baseline over many fires. R1 still hard-rejects consecutive repeats,
    // so 'photoreal' can't win every time — but it should win far more than 1/14.
    const bias = { styleFamilyBias: { photoreal: 10.0 } }
    let photoCount = 0
    let otherCount = 0
    for (let i = 0; i < 200; i++) {
      const r = chooseNextGeneration({ scheduledTimeMs: t0 + i * SIX_HOURS, recent: [], provider: PROVIDER, bias })
      if (r.styleFamily === 'photoreal') photoCount++
      else otherCount++
    }
    // Baseline without bias: photoreal ≈ 1/14 ≈ 7%. With 10× bias, >> baseline.
    expect(photoCount).toBeGreaterThan(otherCount * 0.3)
  })

  it('all R-rules still apply when bias is set (R1: no consecutive style)', () => {
    const bias = { styleFamilyBias: { photoreal: 10.0 } }
    const recent: RecentRecipe[] = [makeRecent({ styleFamily: 'photoreal' })]
    for (let i = 0; i < 100; i++) {
      const r = chooseNextGeneration({ scheduledTimeMs: t0 + i * SIX_HOURS, recent, provider: PROVIDER, bias })
      expect(r.styleFamily).not.toBe('photoreal')
    }
  })
})
