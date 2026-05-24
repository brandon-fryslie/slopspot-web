import { describe, expect, it } from 'vitest'
import {
  ASPECT_RATIOS,
  CHOOSER_SUBJECT_TEMPLATE_IDS,
  STYLE_FAMILIES,
  type AspectRatio,
  type ChooserSubjectTemplateId,
  type StyleFamily,
} from '~/lib/variety'
import { chooseNextGeneration } from './chooseNextGeneration'

// [LAW:behavior-not-structure] These tests pin the chooser's *contract*: every
// output is a valid recipe in the variety taxonomy, the choice is a pure
// function of scheduledTime, and the dimensions spread independently. pl6.5
// will add anti-rep rules on top; the contract pinned here must still hold —
// (deterministic, valid, well-distributed) is the floor under any future
// chooser.

const MINUTE = 60 * 1000
const SIX_HOURS = 6 * 60 * MINUTE

describe('chooseNextGeneration', () => {
  it('is deterministic: same scheduledTime → same recipe', () => {
    const t = Date.UTC(2026, 5, 17, 12, 0, 0)
    expect(chooseNextGeneration(t)).toEqual(chooseNextGeneration(t))
  })

  it('produces a valid styleFamily, ChooserSubjectTemplateId, and AspectRatio', () => {
    const t = Date.UTC(2026, 5, 17, 12, 0, 0)
    const r = chooseNextGeneration(t)
    expect(STYLE_FAMILIES).toContain(r.styleFamily satisfies StyleFamily)
    expect(CHOOSER_SUBJECT_TEMPLATE_IDS).toContain(
      r.subject.subjectTemplate satisfies ChooserSubjectTemplateId,
    )
    expect(ASPECT_RATIOS).toContain(r.aspectRatio satisfies AspectRatio)
  })

  it('never produces the T00 backfill template (chooser exclusion by type)', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    for (let i = 0; i < 1000; i++) {
      const r = chooseNextGeneration(t0 + i * SIX_HOURS)
      expect(r.subject.subjectTemplate).not.toBe('T00')
    }
  })

  it('renders a non-empty composed prompt with the style prompt seed appended', () => {
    const t = Date.UTC(2026, 5, 17, 12, 0, 0)
    const r = chooseNextGeneration(t)
    expect(typeof r.prompt).toBe('string')
    expect(r.prompt.length).toBeGreaterThan(0)
    // The style family's seed is concatenated after the subject phrase.
    expect(r.prompt).toContain(',')
  })

  it('covers all 14 style families over a long enough window', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    const seen = new Set<StyleFamily>()
    for (let i = 0; i < 365 * 4; i++) {
      seen.add(chooseNextGeneration(t0 + i * SIX_HOURS).styleFamily)
    }
    expect(seen.size).toBe(STYLE_FAMILIES.length)
  })

  it('covers all 40 chooser templates over a long enough window', () => {
    const t0 = Date.UTC(2026, 0, 1, 0, 0, 0)
    const seen = new Set<ChooserSubjectTemplateId>()
    for (let i = 0; i < 365 * 4; i++) {
      seen.add(chooseNextGeneration(t0 + i * SIX_HOURS).subject.subjectTemplate)
    }
    expect(seen.size).toBe(CHOOSER_SUBJECT_TEMPLATE_IDS.length)
  })

  it('does not collapse onto a single combination at the production cron cadence', () => {
    const t0 = Date.UTC(2026, 5, 17, 0, 0, 0)
    const styles = new Set<StyleFamily>()
    const templates = new Set<ChooserSubjectTemplateId>()
    for (let i = 0; i < 14; i++) {
      const r = chooseNextGeneration(t0 + i * SIX_HOURS)
      styles.add(r.styleFamily)
      templates.add(r.subject.subjectTemplate)
    }
    expect(styles.size).toBeGreaterThan(1)
    expect(templates.size).toBeGreaterThan(1)
  })

  it('handles t=0 and negative scheduledTime without throwing', () => {
    expect(() => chooseNextGeneration(0)).not.toThrow()
    expect(() => chooseNextGeneration(-MINUTE)).not.toThrow()
  })
})
