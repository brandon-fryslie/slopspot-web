import { describe, expect, it } from 'vitest'
import {
  ASPECT_RATIOS,
  CHOOSER_SUBJECT_TEMPLATE_IDS,
  recipeSubjectSchema,
  renderTemplate,
  SLOT_VOCABS,
  STORED_SUBJECT_TEMPLATE_IDS,
  STYLE_FAMILIES,
  STYLE_FAMILY_PROMPT_SEEDS,
  STYLE_FAMILY_PROVIDER_WEIGHTS,
  TEMPLATE_PHRASES,
  TEMPLATE_SLOT_KEYS,
  type StyleFamily,
} from '~/lib/variety'

// [LAW:types-are-the-program] These tests pin the doc-to-code invariants that
// the type system cannot enforce alone:
//   - TEMPLATE_SLOT_KEYS[id] matches the placeholders mechanically extracted
//     from TEMPLATE_PHRASES[id]. Drift between phrase and slot list fails here
//     before it lands in a malformed recipe.
//   - Every style family has a prompt seed entry — adding a family without
//     updating the seeds map fails this test, not at chooser-runtime.
//   - Every chooser template id is also a stored template id (the doc's
//     value-level superset relationship).

// Extract {placeholders} from a phrase, deduplicate by name in first-occurrence
// order. Mirrors the doc's "mechanically derivable from each phrase" rule.
function extractPlaceholders(phrase: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const re = /\{(\w+)\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(phrase)) !== null) {
    const slot = match[1]!
    if (!seen.has(slot)) {
      seen.add(slot)
      out.push(slot)
    }
  }
  return out
}

describe('variety taxonomy', () => {
  it('every template slot key list matches the phrase placeholders (mechanical)', () => {
    for (const id of STORED_SUBJECT_TEMPLATE_IDS) {
      const declared = [...TEMPLATE_SLOT_KEYS[id]].sort()
      const extracted = extractPlaceholders(TEMPLATE_PHRASES[id]).sort()
      expect(declared).toEqual(extracted)
    }
  })

  it('every style family has a prompt seed', () => {
    for (const family of STYLE_FAMILIES) {
      expect(STYLE_FAMILY_PROMPT_SEEDS[family]).toBeTruthy()
    }
  })

  it('chooser template ids are a strict subset of stored template ids (T00 is the only delta)', () => {
    const stored = new Set<string>(STORED_SUBJECT_TEMPLATE_IDS)
    for (const id of CHOOSER_SUBJECT_TEMPLATE_IDS) {
      expect(stored.has(id)).toBe(true)
    }
    const delta = STORED_SUBJECT_TEMPLATE_IDS.filter(
      (id) => !CHOOSER_SUBJECT_TEMPLATE_IDS.includes(id as never),
    )
    expect(delta).toEqual(['T00'])
  })

  it('has exactly the doc-specified counts (14 styles, 5 aspects, 41 stored / 40 chooser templates)', () => {
    expect(STYLE_FAMILIES.length).toBe(14)
    expect(ASPECT_RATIOS.length).toBe(5)
    expect(STORED_SUBJECT_TEMPLATE_IDS.length).toBe(41)
    expect(CHOOSER_SUBJECT_TEMPLATE_IDS.length).toBe(40)
  })

  it('SLOT_VOCABS covers every non-freeText slot referenced by any template', () => {
    const allSlots = new Set<string>()
    for (const id of STORED_SUBJECT_TEMPLATE_IDS) {
      for (const slot of TEMPLATE_SLOT_KEYS[id]) {
        allSlots.add(slot)
      }
    }
    for (const slot of allSlots) {
      if (slot === 'freeText') continue
      expect(SLOT_VOCABS).toHaveProperty(slot)
      const vocab = (SLOT_VOCABS as Record<string, readonly string[]>)[slot]
      expect(vocab.length).toBeGreaterThan(0)
    }
  })
})

describe('recipeSubjectSchema', () => {
  it('accepts a T00 subject with freeText', () => {
    const r = recipeSubjectSchema.safeParse({
      subjectTemplate: 'T00',
      slots: { freeText: 'a sock' },
    })
    expect(r.success).toBe(true)
  })

  it('accepts a T01 subject with the right slots', () => {
    const r = recipeSubjectSchema.safeParse({
      subjectTemplate: 'T01',
      slots: { animal: 'fennec', profession: 'lighthouse-keeper' },
    })
    expect(r.success).toBe(true)
  })

  it('rejects a T05 subject missing timeOfDay (slot shape must match template)', () => {
    const r = recipeSubjectSchema.safeParse({
      subjectTemplate: 'T05',
      slots: { setting: 'motel-corridor' },
    })
    expect(r.success).toBe(false)
  })

  it('rejects unknown slot keys (strict object)', () => {
    const r = recipeSubjectSchema.safeParse({
      subjectTemplate: 'T20',
      slots: { setting: 'gas-station', extraneous: 'no' },
    })
    expect(r.success).toBe(false)
  })

  it('rejects an unknown subjectTemplate id', () => {
    const r = recipeSubjectSchema.safeParse({
      subjectTemplate: 'T99',
      slots: {},
    })
    expect(r.success).toBe(false)
  })
})

describe('renderTemplate', () => {
  it('emits the freeText verbatim for T00', () => {
    const subject = recipeSubjectSchema.parse({
      subjectTemplate: 'T00',
      slots: { freeText: 'a hand-curated prompt' },
    })
    expect(renderTemplate(subject)).toBe('a hand-curated prompt')
  })

  it('chooses `a` before a consonant-start value', () => {
    const subject = recipeSubjectSchema.parse({
      subjectTemplate: 'T01',
      slots: { animal: 'cat', profession: 'surgeon' },
    })
    expect(renderTemplate(subject)).toBe('a cat working as a surgeon')
  })

  it('chooses `an` before a vowel-start value (lowercased)', () => {
    const subject = recipeSubjectSchema.parse({
      subjectTemplate: 'T01',
      slots: { animal: 'otter', profession: 'archivist' },
    })
    expect(renderTemplate(subject)).toBe('an otter working as an archivist')
  })

  it('normalizes uppercase-start values via the lowercase-first-character rule', () => {
    // "an ATM" — uppercase 'A' lowercases to 'a' (vowel) → `an`
    const subject = recipeSubjectSchema.parse({
      subjectTemplate: 'T10',
      slots: { manMadeObject: 'ATM' },
    })
    expect(renderTemplate(subject)).toBe(
      'diagram of how an ATM actually works (charmingly wrong)',
    )
  })

  it('fills duplicate placeholders with the same value (T35 recursive setting)', () => {
    const subject = recipeSubjectSchema.parse({
      subjectTemplate: 'T35',
      slots: { setting: 'motel-corridor' },
    })
    expect(renderTemplate(subject)).toBe(
      'a motel-corridor that you can only reach through a motel-corridor',
    )
  })
})

describe('style family enumeration sanity', () => {
  it('every style family in STYLE_FAMILIES is in STYLE_FAMILY_PROMPT_SEEDS, and vice versa', () => {
    const families = new Set<StyleFamily>(STYLE_FAMILIES)
    const seedKeys = new Set(Object.keys(STYLE_FAMILY_PROMPT_SEEDS))
    expect([...families].sort()).toEqual([...seedKeys].sort())
  })
})

describe('provider weight table sanity', () => {
  it('STYLE_FAMILY_PROVIDER_WEIGHTS has a row for every style family with at least one nonzero entry', () => {
    for (const style of STYLE_FAMILIES) {
      expect(STYLE_FAMILY_PROVIDER_WEIGHTS[style]).toBeDefined()
      const nonzero = Object.values(STYLE_FAMILY_PROVIDER_WEIGHTS[style]).filter((w) => w > 0)
      expect(nonzero.length).toBeGreaterThan(0)
    }
  })
})
