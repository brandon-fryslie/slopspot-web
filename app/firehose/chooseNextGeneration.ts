// [LAW:one-source-of-truth] The firehose's recipe chooser. pl6.2 ships this
// stub: deterministic from scheduledTime, uniform across the variety
// taxonomy, no anti-repetition. pl6.5 enhances this same module with R1–R6
// anti-rep rules over the last 20 persisted posts; the function name and
// return shape stay stable across that change so the cron handler doesn't
// need to know which version is wired.
//
// [LAW:types-are-the-program] `chooseNextGeneration` is pure relative to its
// argument: scheduled time in, full recipe out (style + subject + aspect +
// composed prompt). No clocks, no env, no I/O. pl6.5 will widen the signature
// to accept the last-N persisted recipes; until then, the uniform sampler is
// good enough to satisfy the new Generation shape end-to-end.

import {
  ASPECT_RATIOS,
  CHOOSER_SUBJECT_TEMPLATE_IDS,
  recipeSubjectSchema,
  renderTemplate,
  SLOT_VOCABS,
  STYLE_FAMILIES,
  STYLE_FAMILY_PROMPT_SEEDS,
  TEMPLATE_SLOT_KEYS,
  type AspectRatio,
  type ChooserRecipeSubject,
  type ChooserSubjectTemplateId,
  type StyleFamily,
} from '~/lib/variety'

// [LAW:types-are-the-program] ChooserOutput.subject is narrowed to exclude T00
// — that's a chooser-vs-stored distinction, not a runtime check. See the
// ChooserRecipeSubject type for the exact narrowing.
export type ChooserOutput = {
  styleFamily: StyleFamily
  subject: ChooserRecipeSubject
  aspectRatio: AspectRatio
  prompt: string
}

// [LAW:types-are-the-program] FNV-1a 32-bit on a kind-tagged string form of the
// timestamp. The kind tag means the same scheduledTime samples *independently*
// across style/subject/aspect/slot dimensions — fnv1a32('style:t') and
// fnv1a32('aspect:t') are uncorrelated, so a given fire's choice along one
// axis doesn't constrain the others. Plain `tick % len` was sensitive to the
// cron cadence's modular alignment (a 6-hour cadence collides every fire on
// list lengths that divide 360 minutes); FNV decouples bucket from cadence.
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function pick<T>(list: readonly T[], seed: number, kind: string): T {
  const idx = fnv1a32(`${kind}:${seed}`) % list.length
  return list[idx]!
}

// Sample required slots for the chosen template uniformly from their vocabs.
// Each (template, slot-key) pair gets an independent hash, so two slots of the
// same vocab type within one template (e.g. T35's recursive setting) draw
// from the same vocab but at independent positions per the kind-tagged hash.
//
// The slot key type narrows to (animal | profession | manMadeObject |
// naturalObject | setting | timeOfDay | era | emotion | abstractConcept) — TS
// can see from TEMPLATE_SLOT_KEYS that no T01–T40 template references
// freeText, so SLOT_VOCABS[key] is statically total. No runtime "is it
// freeText?" check needed; the type already forbids it.
function sampleSlots(
  template: ChooserSubjectTemplateId,
  seed: number,
): Record<string, string> {
  const keys = TEMPLATE_SLOT_KEYS[template]
  const slots: Record<string, string> = {}
  for (const key of keys) {
    const vocab = SLOT_VOCABS[key]
    slots[key] = pick(vocab, seed, `slot:${template}:${key}`)
  }
  return slots
}

// [LAW:dataflow-not-control-flow] Same five operations every fire:
// pick style → pick template → pick aspect → sample slots → compose prompt.
// No branches on "is this the first invocation," no fallbacks, no env. The
// output is a function of the input alone.
export function chooseNextGeneration(scheduledTimeMs: number): ChooserOutput {
  const styleFamily = pick(STYLE_FAMILIES, scheduledTimeMs, 'style')
  const subjectTemplate = pick(
    CHOOSER_SUBJECT_TEMPLATE_IDS,
    scheduledTimeMs,
    'subject',
  )
  const aspectRatio = pick(ASPECT_RATIOS, scheduledTimeMs, 'aspect')
  const slots = sampleSlots(subjectTemplate, scheduledTimeMs)
  // [LAW:no-defensive-null-guards] Round-trip through recipeSubjectSchema as
  // the construction site for RecipeSubject: this is the chooser's own trust
  // boundary, proving the (template, slots) pair satisfies the discriminated
  // union before it leaves the function. A failure here is a chooser bug, not
  // a caller issue — fail loud so it's caught in tests rather than landing in
  // a malformed D1 row.
  //
  // Narrow to ChooserRecipeSubject: subjectTemplate is statically a
  // ChooserSubjectTemplateId (T01–T40), so the schema's T00 variant is
  // unreachable at this call site. The `as ChooserRecipeSubject` is the
  // single point where the wider-than-needed schema output is narrowed to
  // the chooser's contract — proven by the surrounding code, not asserted.
  const parsed = recipeSubjectSchema.parse({ subjectTemplate, slots })
  const subject = parsed as ChooserRecipeSubject
  const prompt = `${renderTemplate(subject)}, ${STYLE_FAMILY_PROMPT_SEEDS[styleFamily]}`
  return { styleFamily, subject, aspectRatio, prompt }
}
