// [LAW:single-enforcer] The one place prompt text is generated from a recipe.
// All generator-persona fires go through composePrompt; renderTemplate is the
// fallback only when the Haiku call fails. No other module calls renderTemplate
// for prompt output.
//
// [LAW:one-way-deps] composer.ts → Anthropic API (outbound HTTP), variety.ts
// (pure). No back-edge from the chooser or the DB layer.

import { emit } from '~/observability/metrics'
import {
  ASPECT_RATIO_LABELS,
  STYLE_FAMILY_PROMPT_SEEDS,
  renderTemplate,
  type AspectRatio,
  type RecipeSubject,
  type StyleFamily,
} from '~/lib/variety'

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const REQUEST_TIMEOUT_MS = 15_000
const MAX_TOKENS = 300

export type ComposerInput = {
  styleFamily: StyleFamily
  subject: RecipeSubject
  aspectRatio: AspectRatio
  // [RECONCILE B] The persona's authoring voice — the single steering input a
  // persona contributes to composition. The firehose passes the generator
  // persona's voice; the Well passes the seated citizen's. One composer, one
  // voice per persona, identical across both paths. Taken as a value (not the
  // whole Persona) so the composer never re-parses config_json — the persona's
  // own trust boundary already projected it. [LAW:one-source-of-truth]
  voice?: string
  // [RECONCILE B] The human WISH that occasioned a Well fire — provenance, never
  // the prompt. The composer READS it to steer Haiku in the persona's voice; the
  // returned (machine-authored) prompt is what reaches the provider. Absent for
  // the firehose. [LAW:dataflow-not-control-flow] The wish reaches the provider
  // ONLY through Haiku's transmutation — the fallback is recipe-only, so a wish
  // cannot leak verbatim even when Haiku is unavailable. foundation.3's isolation
  // (the wish is never a generation input) holds here by construction, not a guard.
  wish?: string
  // [LAW:single-enforcer] The chosen provider's authoritative max prompt
  // length. Passed from generator.ts via provider.promptMaxLength so the
  // constraint travels from its declaration site to the composition step.
  maxLength?: number
}

// [LAW:dataflow-not-control-flow] The fallback is data flowing through the
// same return type — not a branch that skips composition. Haiku is called
// unconditionally; a failure swaps the value to the renderTemplate output
// without changing the return signature.
export async function composePrompt(input: ComposerInput, env: Env): Promise<string> {
  const { styleFamily, subject, aspectRatio, voice, wish, maxLength } = input
  const apiKey = env.SLOPSPOT_ANTHROPIC_API_KEY

  const rendered = renderTemplate(subject)
  const styleSeed = STYLE_FAMILY_PROMPT_SEEDS[styleFamily]
  // [LAW:dataflow-not-control-flow] The wish is NOT in the fallback — not as a
  // guard against leaking it, but because the fallback's job is a recipe-only
  // machine prompt; the wish's only authoring path is Haiku. Same recipe shape
  // whether or not a wish was made.
  const fallback = voice
    ? `${voice}, ${rendered}, ${styleSeed}`
    : `${rendered}, ${styleSeed}`

  if (!apiKey) {
    console.warn('composer: SLOPSPOT_ANTHROPIC_API_KEY not set; using renderTemplate fallback')
    emit('slopspot.composer.result', { outcome: 'fallback', reason: 'missing_key' }, 1)
    return fallback
  }

  // [LAW:one-source-of-truth] ASPECT_RATIO_LABELS is the shared mapping.
  const aspectLabel = ASPECT_RATIO_LABELS[aspectRatio]

  const metaPrompt = [
    `Write a vivid image generation prompt for a ${styleFamily} piece depicting ${rendered}.`,
    `Aspect ratio: ${aspectLabel}.`,
    `Style notes: ${styleSeed}.`,
    voice ? `Voice / tone: ${voice}.` : null,
    // [RECONCILE B] The wish steers, it is never echoed. Haiku transmutes the
    // visitor's intent in the persona's voice; the returned prompt is the
    // machine's — recognizably related to the wish, never obedient to it.
    wish
      ? `A visitor wished for: ${JSON.stringify(wish)}. Reinterpret their wish in your own voice — transmute their intent, never repeat their words back. The result must be recognizably related to the wish yet unmistakably your own authorship, not obedient to their literal request.`
      : null,
    maxLength ? `Keep the prompt under ${maxLength} characters.` : null,
    'Output only the prompt text itself — no preamble, no quotes, no explanation.',
  ]
    .filter(Boolean)
    .join(' ')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: metaPrompt }],
      }),
      signal: controller.signal,
    })

    if (!resp.ok) {
      const body = await resp.text()
      throw new Error(`Anthropic ${resp.status}: ${body}`)
    }

    type AnthropicMessage = { content: Array<{ type: string; text?: string }> }
    const data = (await resp.json()) as AnthropicMessage
    const text = data.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('')
      .trim()

    if (!text) throw new Error('empty text block in Anthropic response')

    // Hard-truncate as a safeguard: the instruction above targets the model,
    // but we own the constraint and must not pass an over-length string to
    // defaultParamsForRecipe / paramsSchema.
    const result = maxLength && text.length > maxLength ? text.slice(0, maxLength) : text
    emit('slopspot.composer.result', { outcome: 'haiku' }, 1)
    return result
  } catch (err) {
    console.error('composer: Haiku call failed; using renderTemplate fallback', {
      styleFamily,
      subjectTemplate: subject.subjectTemplate,
      err,
    })
    emit('slopspot.composer.result', { outcome: 'fallback', reason: 'api_error' }, 1)
    return fallback
  } finally {
    clearTimeout(timeoutId)
  }
}
