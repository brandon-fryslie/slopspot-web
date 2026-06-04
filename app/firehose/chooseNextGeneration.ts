// [LAW:single-enforcer] The firehose's recipe chooser. Pure function — takes
// (scheduledTimeMs, recent, provider) and returns a recipe with all variety
// fields. Prompt composition and params building are downstream concerns that
// require env/I/O (composer.ts) and belong in the caller (generator.ts).
//
// [LAW:types-are-the-program] `chooseNextGeneration` is a pure function: it
// takes (scheduledTimeMs, recent, provider) and returns a complete recipe.
// No clocks, no env, no I/O. All anti-rep rules (R1, R2, R4, R5, R6) are
// expressed as weighted-distribution modifiers, not control-flow branches —
// empty `recent` reduces every rule to a no-op without a "first run" check.
// [RECONCILE C] The provider is a single fixed input (the author-persona's
// medium), not a pool to pick from — there is no R3 (provider rotation).

import type { ProviderId } from '~/lib/domain'
import {
  ASPECT_RATIOS,
  ASPECT_RATIO_BASE_WEIGHTS,
  CHOOSER_SUBJECT_TEMPLATE_IDS,
  recipeSubjectSchema,
  SLOT_VOCABS,
  STYLE_FAMILIES,
  STYLE_FAMILY_ASPECT_BIAS,
  TEMPLATE_SLOT_KEYS,
  type AspectRatio,
  type ChooserRecipeSubject,
  type ChooserSubjectTemplateId,
  type SlotId,
  type StyleFamily,
} from '~/lib/variety'
import type { RecentRecipe } from '~/db/recent'
import { seedHash } from '~/lib/hash'
import { pickWeighted } from '~/lib/weighted'
import type { GenerationProvider } from '~/providers/types'

// [LAW:types-are-the-program] Inputs the chooser needs are exactly three:
// when the cron fired, what we've recently produced, and the provider the slop
// will use (the author-persona's medium). Anything else (env, registry-via-
// side-effect) would fold I/O into the function.
//
// `recent` is in most-recent-first order. The chooser's R-rule windows slice
// from the head: `recent.slice(0, 1)` for R1, `recent.slice(0, 5)` for R2,
// etc. An empty slice contributes no rejections and no downweights, so the
// bootstrap case is the same code path as steady-state. [LAW:dataflow-not-control-flow]
//
// `bias` carries persona-flavor multipliers over the dimensions the chooser
// samples — style family and aspect ratio. Absent keys default to 1.0 (no-op);
// absent `bias` = all-ones on every dimension. Same chooser body every fire; the
// bias values flow through the weight functions, never gating the body.
// [LAW:dataflow-not-control-flow]
//
// [RECONCILE C] No `providerBias`: the provider is not chosen here, it is the
// passed-in medium. promptPrefix is not on `bias` either — it steers prompt
// *composition* (composer.ts), not recipe *selection*, so it lives only on the
// composer's input, never here where it would imply it affects the draw.
export type PersonaBias = {
  styleFamilyBias?: Partial<Record<StyleFamily, number>>
  aspectRatioBias?: Partial<Record<AspectRatio, number>>
}

// [LAW:types-are-the-program] [RECONCILE C] The chooser takes the SINGLE provider
// the slop will use — the author-persona's medium — not a pool to pick from. The
// provider is data the chooser consumes (to gate aspect ratios to what it serves
// and to stamp `providerId` on the recipe), never a dimension it samples.
export type ChooserInput = {
  scheduledTimeMs: number
  recent: readonly RecentRecipe[]
  provider: GenerationProvider<unknown>
  bias?: PersonaBias
}

// [LAW:types-are-the-program] ChooserOutput.subject narrows to
// ChooserRecipeSubject (T00 excluded by construction). `paramsSeed` is the
// pre-computed entropy for defaultParamsForRecipe — the caller (generator.ts)
// uses it after composing the prompt via composer.ts. Params and prompt are
// absent: the chooser has no env, so it cannot call Haiku; prompt composition
// is the single concern of composer.ts.
export type ChooserOutput = {
  providerId: ProviderId
  paramsSeed: number
  styleFamily: StyleFamily
  subject: ChooserRecipeSubject
  aspectRatio: AspectRatio
}

// [LAW:one-source-of-truth] Window sizes and downweight factors are the doc's
// §Anti-repetition rules table. Named constants so the test file can pin them
// in expectations without restating magic numbers.
const R2_WINDOW = 5
const R5_WINDOW = 20
const R5_REPEAT_THRESHOLD = 3
const R5_DOWNWEIGHT = 0.3
const R6_WINDOW = 20
const R6_DOWNWEIGHT = 0.5

function countBy<T>(items: readonly T[]): Map<T, number> {
  const out = new Map<T, number>()
  for (const item of items) out.set(item, (out.get(item) ?? 0) + 1)
  return out
}

// R1 hard-rejects the most-recent style family (window 1).
// R5 soft-downweights any style family appearing ≥R5_REPEAT_THRESHOLD times in
// the last R5_WINDOW. Empty `recent` → both rules contribute nothing.
// `biasMult` multiplies per-family — absent key = 1.0 (no-op). [LAW:dataflow-not-control-flow]
function styleFamilyWeights(
  recent: readonly RecentRecipe[],
  biasMult?: Partial<Record<StyleFamily, number>>,
): number[] {
  const r1Reject = recent[0]?.styleFamily
  const r5Counts = countBy(recent.slice(0, R5_WINDOW).map((r) => r.styleFamily))
  return STYLE_FAMILIES.map((s) => {
    if (s === r1Reject) return 0
    const heavy = (r5Counts.get(s) ?? 0) >= R5_REPEAT_THRESHOLD
    const base = heavy ? R5_DOWNWEIGHT : 1.0
    return base * (biasMult?.[s] ?? 1.0)
  })
}

// R2 hard-rejects any subject template appearing in the last R2_WINDOW posts.
// Stored T00 rows can't appear in CHOOSER_SUBJECT_TEMPLATE_IDS, so the lookup
// just never matches them — T00 is unrepresentable for the chooser by type,
// inert at runtime by data.
function subjectTemplateWeights(recent: readonly RecentRecipe[]): number[] {
  const recentTemplates = new Set(
    recent.slice(0, R2_WINDOW).map((r) => r.subjectTemplate),
  )
  return CHOOSER_SUBJECT_TEMPLATE_IDS.map((t) => (recentTemplates.has(t) ? 0 : 1.0))
}

// R6 soft-downweights vocab values that appeared in the last R6_WINDOW posts
// in this slot position. Iteration scans every recent row's slots map; absent
// keys (a recent T00 row doesn't carry `animal`) contribute no downweight to
// this slot, naturally.
function slotWeights(
  vocab: readonly string[],
  slotKey: string,
  recent: readonly RecentRecipe[],
): number[] {
  const used = new Set<string>()
  for (const r of recent.slice(0, R6_WINDOW)) {
    const v = r.slots[slotKey]
    if (v !== undefined) used.add(v)
  }
  return vocab.map((v) => (used.has(v) ? R6_DOWNWEIGHT : 1.0))
}

// R4 hard-rejects the candidate aspect ratio if and only if the last two
// recent posts share that same aspect ratio (two-in-a-row allowed, three-in-
// a-row forbidden). Base weights × style-family bias multipliers from
// variety.ts. Provider's supportedAspectRatios is the per-provider gate —
// any ratio not in the provider's set gets 0 weight, so the chooser cannot
// hand a provider a ratio it can't serve.
// `biasMult` is the persona's aspect-ratio preference — multiplies the base weight.
// [LAW:dataflow-not-control-flow] same code path every fire; absent key = 1.0.
function aspectRatioWeights(
  styleFamily: StyleFamily,
  provider: GenerationProvider<unknown>,
  recent: readonly RecentRecipe[],
  biasMult?: Partial<Record<AspectRatio, number>>,
): number[] {
  const sfBias = STYLE_FAMILY_ASPECT_BIAS[styleFamily]
  const last2 = recent.slice(0, 2)
  const r4Reject =
    last2.length === 2 && last2[0]!.aspectRatio === last2[1]!.aspectRatio
      ? last2[0]!.aspectRatio
      : null
  const supported = new Set<AspectRatio>(provider.supportedAspectRatios)
  return ASPECT_RATIOS.map((a) => {
    if (!supported.has(a)) return 0
    if (a === r4Reject) return 0
    return ASPECT_RATIO_BASE_WEIGHTS[a] * (sfBias[a] ?? 1.0) * (biasMult?.[a] ?? 1.0)
  })
}

function sampleSlots(
  template: ChooserSubjectTemplateId,
  recent: readonly RecentRecipe[],
  seed: number,
): Record<string, string> {
  const keys = TEMPLATE_SLOT_KEYS[template]
  const slots: Record<string, string> = {}
  for (const key of keys) {
    // TS narrowing: TEMPLATE_SLOT_KEYS[T01..T40] only references the 9 non-
    // freeText SlotIds. SLOT_VOCABS is keyed by those same 9, so the lookup is
    // statically total — the cast just lifts the SlotId-with-freeText union
    // down to SLOT_VOCABS's domain.
    const vocab = SLOT_VOCABS[key as Exclude<SlotId, 'freeText'>]
    const weights = slotWeights(vocab, key, recent)
    slots[key] = pickWeighted(vocab, weights, seed, `slot:${template}:${key}`)
  }
  return slots
}

// [LAW:dataflow-not-control-flow] Same operations every fire — sample style →
// sample subject → sample slots → sample aspect. R-rules feed weights, never
// branches. Persona bias multipliers flow through the weight functions; absent
// bias = 1.0 on every dimension, making persona=null and persona=all-ones
// identical code paths. [RECONCILE C] The provider is fixed (the author-persona's
// medium), so it is not sampled — only its supportedAspectRatios gate the aspect draw.
//
// Prompt composition and params building are the caller's responsibility:
// the caller awaits composePrompt (composer.ts), then calls
// provider.defaultParamsForRecipe({ prompt, styleFamily, seed: paramsSeed }).
// [LAW:one-way-deps] chooser stays pure — no env, no I/O.
export function chooseNextGeneration(input: ChooserInput): ChooserOutput {
  const { scheduledTimeMs, recent, provider, bias } = input

  const styleFamily = pickWeighted(
    STYLE_FAMILIES,
    styleFamilyWeights(recent, bias?.styleFamilyBias),
    scheduledTimeMs,
    'style',
  )

  const subjectTemplate = pickWeighted(
    CHOOSER_SUBJECT_TEMPLATE_IDS,
    subjectTemplateWeights(recent),
    scheduledTimeMs,
    'subject',
  )

  const slots = sampleSlots(subjectTemplate, recent, scheduledTimeMs)

  const aspectRatio = pickWeighted(
    ASPECT_RATIOS,
    aspectRatioWeights(styleFamily, provider, recent, bias?.aspectRatioBias),
    scheduledTimeMs,
    'aspect',
  )

  // [LAW:no-defensive-null-guards] Construction-site parse: this is the
  // chooser's own trust boundary, proving (template, slots) satisfies the
  // discriminated union before leaving the function. Narrowing to
  // ChooserRecipeSubject is provable from subjectTemplate's static type
  // (T01..T40), the schema's T00 variant is unreachable here.
  const parsed = recipeSubjectSchema.parse({ subjectTemplate, slots })
  const subject = parsed as ChooserRecipeSubject

  // Separate seed-kind tag for params so a future provider that varies params
  // by entropy can sample independently of the style/aspect/subject draws.
  const paramsSeed = seedHash(scheduledTimeMs, 'params')

  return {
    providerId: provider.id,
    paramsSeed,
    styleFamily,
    subject,
    aspectRatio,
  }
}
