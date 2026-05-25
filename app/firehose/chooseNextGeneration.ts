// [LAW:single-enforcer] The firehose's recipe chooser. The function name and
// return-shape contract are stable since pl6.2; this iteration (pl6.5) widens
// the input and adds providerId+params to the output, while preserving the
// same call shape from `scheduled.ts`.
//
// [LAW:types-are-the-program] `chooseNextGeneration` is a pure function: it
// takes (scheduledTimeMs, recent, providers) and returns a complete recipe.
// No clocks, no env, no I/O. All R-rules (R1..R6) are expressed as weighted-
// distribution modifiers, not control-flow branches — empty `recent` reduces
// every rule to a no-op without a "first run" check.

import type { ProviderId } from '~/lib/domain'
import {
  ASPECT_RATIOS,
  ASPECT_RATIO_BASE_WEIGHTS,
  CHOOSER_SUBJECT_TEMPLATE_IDS,
  recipeSubjectSchema,
  renderTemplate,
  SLOT_VOCABS,
  STYLE_FAMILIES,
  STYLE_FAMILY_ASPECT_BIAS,
  STYLE_FAMILY_PROMPT_SEEDS,
  STYLE_FAMILY_PROVIDER_WEIGHTS,
  TEMPLATE_SLOT_KEYS,
  type AspectRatio,
  type ChooserRecipeSubject,
  type ChooserSubjectTemplateId,
  type SlotId,
  type StyleFamily,
} from '~/lib/variety'
import type { RecentRecipe } from '~/db/recent'
import type { GenerationProvider } from '~/providers/types'

// [LAW:types-are-the-program] Inputs the chooser needs are exactly three:
// when the cron fired, what we've recently produced, and what providers are
// available to pick from. Anything else (env, registry-via-side-effect) would
// fold I/O into the function.
//
// `recent` is in most-recent-first order. The chooser's R-rule windows slice
// from the head: `recent.slice(0, 1)` for R1, `recent.slice(0, 5)` for R2,
// etc. An empty slice contributes no rejections and no downweights, so the
// bootstrap case is the same code path as steady-state. [LAW:dataflow-not-control-flow]
export type ChooserInput = {
  scheduledTimeMs: number
  recent: readonly RecentRecipe[]
  providers: readonly GenerationProvider<unknown>[]
}

// [LAW:types-are-the-program] ChooserOutput.subject narrows to
// ChooserRecipeSubject (T00 excluded by construction). `params: unknown`
// holds the chosen provider's native params; createPost re-validates via
// the provider's paramsSchema, so the unknown is a structural acknowledgment
// that the chooser doesn't carry per-provider types out of the orchestrator —
// the provider's defaultParamsForRecipe is the single typed seam.
export type ChooserOutput = {
  providerId: ProviderId
  params: unknown
  styleFamily: StyleFamily
  subject: ChooserRecipeSubject
  aspectRatio: AspectRatio
  prompt: string
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

// FNV-1a 32-bit over a kind-tagged string form of the seed. The kind tag means
// the same scheduledTime samples independently across style/subject/aspect/
// provider/slot dimensions — fnv1a32('style:t') and fnv1a32('aspect:t') are
// uncorrelated, so a fire's choice along one axis doesn't constrain another.
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

// [LAW:types-are-the-program] Weighted picker. `items` and `weights` align by
// index; total weight must be positive. The seed+kind tag → a uniform float in
// [0, total) which selects an index via cumulative sum. Determinism: same
// (items, weights, seed, kind) → same result, every time.
//
// A zero total is a configuration bug — the candidate pool has been emptied by
// over-aggressive rejection rules. Fail loud rather than silently fall back.
function pickWeighted<T>(
  items: readonly T[],
  weights: readonly number[],
  seed: number,
  kind: string,
): T {
  if (items.length !== weights.length) {
    throw new Error(
      `pickWeighted: items.length=${items.length} != weights.length=${weights.length} (kind=${kind})`,
    )
  }
  let total = 0
  for (const w of weights) total += w
  if (!(total > 0)) {
    throw new Error(`pickWeighted: total weight not positive (kind=${kind}, total=${total})`)
  }
  const r = (fnv1a32(`${kind}:${seed}`) / 0x100000000) * total
  let acc = 0
  for (let i = 0; i < items.length; i++) {
    acc += weights[i]!
    if (r < acc) return items[i]!
  }
  return items[items.length - 1]!
}

function countBy<T>(items: readonly T[]): Map<T, number> {
  const out = new Map<T, number>()
  for (const item of items) out.set(item, (out.get(item) ?? 0) + 1)
  return out
}

// R1 hard-rejects the most-recent style family (window 1).
// R5 soft-downweights any style family appearing ≥R5_REPEAT_THRESHOLD times in
// the last R5_WINDOW. Empty `recent` → both rules contribute nothing.
function styleFamilyWeights(recent: readonly RecentRecipe[]): number[] {
  const r1Reject = recent[0]?.styleFamily
  const r5Counts = countBy(recent.slice(0, R5_WINDOW).map((r) => r.styleFamily))
  return STYLE_FAMILIES.map((s) => {
    if (s === r1Reject) return 0
    const heavy = (r5Counts.get(s) ?? 0) >= R5_REPEAT_THRESHOLD
    return heavy ? R5_DOWNWEIGHT : 1.0
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

// R3 hard-rejects the most-recent providerId — but only when the candidate
// pool still has ≥2 nonzero entries after the table lookup, otherwise the
// reject would empty the pool. Matches the doc's "if ≥2 providers are
// registered" intent: with the current STYLE_FAMILY_PROVIDER_WEIGHTS having
// 3 nonzero entries per style, this fires uniformly.
function providerWeights(
  providers: readonly GenerationProvider<unknown>[],
  styleFamily: StyleFamily,
  recent: readonly RecentRecipe[],
): number[] {
  const table = STYLE_FAMILY_PROVIDER_WEIGHTS[styleFamily]
  const r3Reject = recent[0]?.providerId
  const raw = providers.map((p) => table[p.id as string] ?? 0)
  const nonzero = raw.filter((w) => w > 0).length
  if (nonzero >= 2 && r3Reject !== undefined) {
    return providers.map((p, i) => (p.id === r3Reject ? 0 : raw[i]!))
  }
  return raw
}

// R4 hard-rejects the candidate aspect ratio if and only if the last two
// recent posts share that same aspect ratio (two-in-a-row allowed, three-in-
// a-row forbidden). Base weights × style-family bias multipliers from
// variety.ts. Provider's supportedAspectRatios is the per-provider gate —
// any ratio not in the provider's set gets 0 weight, so the chooser cannot
// hand a provider a ratio it can't serve.
function aspectRatioWeights(
  styleFamily: StyleFamily,
  provider: GenerationProvider<unknown>,
  recent: readonly RecentRecipe[],
): number[] {
  const bias = STYLE_FAMILY_ASPECT_BIAS[styleFamily]
  const last2 = recent.slice(0, 2)
  const r4Reject =
    last2.length === 2 && last2[0]!.aspectRatio === last2[1]!.aspectRatio
      ? last2[0]!.aspectRatio
      : null
  const supported = new Set<AspectRatio>(provider.supportedAspectRatios)
  return ASPECT_RATIOS.map((a) => {
    if (!supported.has(a)) return 0
    if (a === r4Reject) return 0
    return ASPECT_RATIO_BASE_WEIGHTS[a] * (bias[a] ?? 1.0)
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
// sample subject → sample slots → sample provider → sample aspect → compose
// prompt → build provider params. R-rules feed weights, never branches.
export function chooseNextGeneration(input: ChooserInput): ChooserOutput {
  const { scheduledTimeMs, recent, providers } = input

  const styleFamily = pickWeighted(
    STYLE_FAMILIES,
    styleFamilyWeights(recent),
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

  const provider = pickWeighted(
    providers,
    providerWeights(providers, styleFamily, recent),
    scheduledTimeMs,
    'provider',
  )

  const aspectRatio = pickWeighted(
    ASPECT_RATIOS,
    aspectRatioWeights(styleFamily, provider, recent),
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

  const prompt = `${renderTemplate(subject)}, ${STYLE_FAMILY_PROMPT_SEEDS[styleFamily]}`

  // Separate seed-kind tag for params so a future provider that varies params
  // by entropy can sample independently of the style/aspect/subject draws.
  const paramsSeed = fnv1a32(`params:${scheduledTimeMs}`)
  const params = provider.defaultParamsForRecipe({
    prompt,
    styleFamily,
    seed: paramsSeed,
  })

  return {
    providerId: provider.id,
    params,
    styleFamily,
    subject,
    aspectRatio,
    prompt,
  }
}
