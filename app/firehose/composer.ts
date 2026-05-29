// [LAW:single-enforcer] The one place prompt text is generated from a recipe.
// All generator-persona fires go through composePrompt; renderTemplate is the
// fallback only when the Haiku call fails. No other module calls renderTemplate
// for prompt output.
//
// [LAW:one-way-deps] composer.ts → Anthropic API (outbound HTTP), variety.ts
// (pure). No back-edge from the chooser or the DB layer.

import {
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
  promptPrefix?: string
}

// [LAW:dataflow-not-control-flow] The fallback is data flowing through the
// same return type — not a branch that skips composition. Haiku is called
// unconditionally; a failure swaps the value to the renderTemplate output
// without changing the return signature.
export async function composePrompt(input: ComposerInput, env: Env): Promise<string> {
  const { styleFamily, subject, aspectRatio, promptPrefix } = input
  const apiKey = env.SLOPSPOT_ANTHROPIC_API_KEY

  const rendered = renderTemplate(subject)
  const styleSeed = STYLE_FAMILY_PROMPT_SEEDS[styleFamily]
  const fallback = promptPrefix
    ? `${promptPrefix}, ${rendered}, ${styleSeed}`
    : `${rendered}, ${styleSeed}`

  if (!apiKey) {
    console.warn('composer: SLOPSPOT_ANTHROPIC_API_KEY not set; using renderTemplate fallback')
    return fallback
  }

  const aspectLabel =
    aspectRatio === '1:1'
      ? 'square'
      : aspectRatio === '16:9'
        ? 'wide landscape'
        : aspectRatio === '9:16'
          ? 'tall portrait'
          : aspectRatio === '4:3'
            ? 'landscape'
            : 'portrait'

  const metaPrompt = [
    `Write a vivid image generation prompt for a ${styleFamily} piece depicting ${rendered}.`,
    `Aspect ratio: ${aspectLabel}.`,
    `Style notes: ${styleSeed}.`,
    promptPrefix ? `Voice / tone: ${promptPrefix}.` : null,
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

    return text
  } catch (err) {
    console.error('composer: Haiku call failed; using renderTemplate fallback', {
      styleFamily,
      subjectTemplate: subject.subjectTemplate,
      err,
    })
    return fallback
  } finally {
    clearTimeout(timeoutId)
  }
}
