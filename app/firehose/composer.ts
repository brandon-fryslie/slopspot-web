// [LAW:single-enforcer] The one place a slop's authored text is generated from a
// recipe: BOTH the machine prompt and the citizen's placard NAME, in a single Haiku
// call. All generator-persona fires go through composePrompt; renderTemplate /
// fallbackTitle are the fallback only when the Haiku call fails. No other module
// composes prompt or title text.
//
// [LAW:one-way-deps] composer.ts → Anthropic API (outbound HTTP), variety.ts
// (pure). No back-edge from the chooser or the DB layer.

import { z } from 'zod'
import { emit } from '~/observability/metrics'
import {
  ASPECT_RATIO_LABELS,
  STYLE_FAMILY_PROMPT_SEEDS,
  capPlacard,
  fallbackTitle,
  renderTemplate,
  type AspectRatio,
  type RecipeSubject,
  type StyleFamily,
} from '~/lib/variety'

const HAIKU_MODEL = 'claude-haiku-4-5-20251001'
const REQUEST_TIMEOUT_MS = 15_000

// [LAW:types-are-the-program] Carry the upstream status ON the thrown value so the
// catch classifies the fallback reason from DATA, not by re-parsing a formatted
// message string. A 401/403 (auth — the key is dead/expired) is operator-actionable
// and distinct from a transient 5xx or a network throw; the discriminator must travel
// to the place that decides the metric reason, not be reconstructed there.
class AnthropicHttpError extends Error {
  constructor(readonly status: number, body: string) {
    super(`Anthropic ${status}: ${body}`)
  }
}
// Room for the prompt plus the short title and the JSON envelope around both.
const MAX_TOKENS = 400

// [LAW:types-are-the-program] The one Haiku call authors BOTH halves of a slop: the
// machine prompt and the citizen's placard. The title is the name of the PIECE (top
// billing on the card); the prompt is the recipe's machine instruction.
export type ComposedSlop = { prompt: string; title: string }

// [LAW:types-are-the-program] The LLM is an untrusted boundary — its JSON is parsed
// with Zod exactly like a provider's upstream response. A malformed shape, a missing
// field, or an empty string falls through to the deterministic fallback rather than
// emitting a nameless or promptless slop.
const composedSlopSchema = z.object({
  title: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
})

// [LAW:types-are-the-program] Extract the first COMPLETE, balanced JSON object from a
// model response — strictly stronger than first-brace-to-last-brace, which a brace
// inside trailing prose (or a second object) could mislead. Scans from the first '{'
// counting depth while tracking string state and escapes, so braces inside the
// title/prompt strings never affect the boundary. Returns null when no balanced
// object is present (→ the caller's deterministic fallback). Tolerates a leading
// ```json fence and trailing commentary by construction.
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1)
  }
  return null
}

// [LAW:single-enforcer] The composer owns its outbound Haiku request, so it caps
// the human wish it embeds — unbounded visitor input must not bloat a paid API
// call. This is the request-protection sibling of the maxLength output truncation
// below, NOT trust-boundary validation (the Well's submission action owns that).
const WISH_SEED_MAX = 1000

// [LAW:types-are-the-program] What occasioned the text being composed, beyond the
// bare firehose recipe. A closed union, so the two non-firehose modes are mutually
// exclusive BY THE TYPE — a wish that is also a self-portrait cannot be expressed,
// where two independent optionals would have re-admitted that illegal state. This
// is deliberately NARROWER than the authoring occasion (generator.ts): it carries
// only what STEERS COMPOSITION — the wish words, or the depicted citizen's name —
// never the human wisher, which is an authoring concern the composer never sees.
// Keeping it here (not importing the authoring type) also keeps the dependency
// one-way: generator → composer, never back. [LAW:one-way-deps][LAW:one-source-of-truth]
export type ComposerOccasion =
  | { kind: 'wish'; wish: string }
  | { kind: 'self-portrait'; displayName: string }

export type ComposerInput = {
  styleFamily: StyleFamily
  subject: RecipeSubject
  aspectRatio: AspectRatio
  // [RECONCILE B] The persona's authoring voice — the single steering input a
  // persona contributes to composition. The firehose passes the generator
  // persona's voice; the Well passes the seated citizen's. One composer, one
  // voice per persona, identical across both paths. Taken as a value (not the
  // whole Persona) so the composer never re-parses config_json — the persona's
  // own trust boundary already projected it. [LAW:one-source-of-truth] Named
  // `promptPrefix` to match the persisted persona config key (renaming the whole
  // concept to `voice` is a migration this ticket forbids; one name across the
  // config→composer boundary beats a prettier name with a translation seam).
  promptPrefix?: string
  // [RECONCILE B] What occasioned this composition. A WISH steers Haiku in the
  // persona's voice yet is never assigned as the prompt raw (the returned prompt is
  // always the machine's authorship or the recipe-only fallback —
  // [LAW:dataflow-not-control-flow] the isolation is "never passed through raw," not
  // "no wish word may appear"); a SELF-PORTRAIT swaps the depiction to the citizen
  // itself while the recipe `subject` still travels to the post row. Both are the
  // SAME single composer, same return type, same voice-steered call — only the
  // depiction/seed value varies. Absent → the firehose depicts the recipe subject.
  // [LAW:single-enforcer] one composer authors every persona's text (foundation.5).
  occasion?: ComposerOccasion
  // [LAW:single-enforcer] The chosen provider's authoritative max prompt
  // length. Passed from generator.ts via provider.promptMaxLength so the
  // constraint travels from its declaration site to the composition step.
  maxLength?: number
}

// [LAW:dataflow-not-control-flow] The fallback is data flowing through the
// same return type — not a branch that skips composition. Haiku is called
// unconditionally; a failure swaps the value to the renderTemplate / fallbackTitle
// pair without changing the return signature. Both halves fall back together: a
// failed call leaves neither an orphan prompt nor an orphan name.
export async function composePrompt(input: ComposerInput, env: Env): Promise<ComposedSlop> {
  const { styleFamily, subject, aspectRatio, promptPrefix, occasion, maxLength } = input
  const apiKey = env.SLOPSPOT_ANTHROPIC_API_KEY

  // [LAW:single-enforcer] Cap the embedded wish at the request boundary the
  // composer owns. slice is a pure transform applied to the value — when the
  // wish is absent it is undefined throughout, no branch around the embed.
  const wishSeed = occasion?.kind === 'wish' ? occasion.wish.slice(0, WISH_SEED_MAX) : undefined

  // [LAW:single-enforcer] One prompt-length enforcer for BOTH the Haiku output and
  // the fallback. The provider's promptMaxLength must hold on every path — an
  // over-length fallback prompt would fail downstream params validation just as a
  // Haiku one would — so the cap is applied through this single closure, not just on
  // the happy path.
  const capPrompt = (p: string) => (maxLength && p.length > maxLength ? p.slice(0, maxLength) : p)

  // [LAW:dataflow-not-control-flow] What this piece DEPICTS is a single value, not a
  // branch in the prompt body: the recipe's subject normally, the citizen itself when
  // a self-portrait was asked for. Both halves of composition (the metaPrompt and the
  // fallback) read this one value, so the self-portrait directive can never disagree
  // with itself across the two paths.
  const depiction = occasion?.kind === 'self-portrait'
    ? `a self-portrait of ${occasion.displayName}, a machine-citizen of this city, rendered in their own hand — their face is whatever their work would make of a face`
    : renderTemplate(subject)
  const styleSeed = STYLE_FAMILY_PROMPT_SEEDS[styleFamily]
  // [LAW:dataflow-not-control-flow] The wish is NOT in the fallback — not as a
  // guard against leaking it, but because the fallback's job is a recipe-only
  // machine prompt; the wish's only authoring path is Haiku. Same recipe shape
  // whether or not a wish was made.
  const fallbackPrompt = promptPrefix
    ? `${promptPrefix}, ${depiction}, ${styleSeed}`
    : `${depiction}, ${styleSeed}`
  // [LAW:one-source-of-truth] The fallback NAME tracks the same DEPICTION the prompt
  // does, so a Haiku-failed slop's placard and its image always describe the same
  // thing: a self-portrait is named for the citizen, anything else by the recipe's
  // deterministic placard (the same one the read boundary derives for legacy rows).
  const fallbackName =
    occasion?.kind === 'self-portrait' ? capPlacard(occasion.displayName) : fallbackTitle(subject)
  const fallback: ComposedSlop = { prompt: capPrompt(fallbackPrompt), title: fallbackName }

  if (!apiKey) {
    console.warn('composer: SLOPSPOT_ANTHROPIC_API_KEY not set; using recipe fallback (prompt + title)')
    emit('slopspot.composer.result', { outcome: 'fallback', reason: 'missing_key' }, 1)
    return fallback
  }

  // [LAW:one-source-of-truth] ASPECT_RATIO_LABELS is the shared mapping.
  const aspectLabel = ASPECT_RATIO_LABELS[aspectRatio]

  const metaPrompt = [
    `Compose a slop for SlopSpot — a city run by machines whose citizens treat AI-generated images as holy relics: reverent about garbage, deadpan, never embarrassed.`,
    `You are authoring a ${styleFamily} piece depicting ${depiction}.`,
    `Aspect ratio: ${aspectLabel}.`,
    `Style notes: ${styleSeed}.`,
    promptPrefix ? `Your voice / tone: ${promptPrefix}.` : null,
    // [RECONCILE B] The wish steers; Haiku transmutes the visitor's intent in the
    // persona's voice. The returned prompt is the machine's authorship —
    // recognizably related to the wish, never obedient to it.
    wishSeed
      ? `A visitor wished for: ${JSON.stringify(wishSeed)}. Reinterpret their wish in your own voice — transmute their intent, never repeat their words back. The result must be recognizably related to the wish yet unmistakably your own authorship, not obedient to their literal request.`
      : null,
    maxLength ? `Keep the prompt under ${maxLength} characters.` : null,
    // [LAW:single-enforcer] The placard is composed HERE, in the same call. It is a
    // short evocative NAME for the piece in the city's register (e.g. "The Cursed
    // One", "St. Brindle's Hallway") — a few words, never a sentence, never the raw
    // prompt, never "Untitled".
    `Also give the piece a "title": a short, evocative placard NAME of a few words — the name a museum would nail over this thing if the museum worshipped garbage. Not a description, not the prompt restated, never "Untitled".`,
    `Respond with ONLY minified JSON: {"title": "...", "prompt": "..."}. No markdown fences, no preamble, no explanation.`,
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
      throw new AnthropicHttpError(resp.status, body)
    }

    type AnthropicMessage = { content: Array<{ type: string; text?: string }> }
    const data = (await resp.json()) as AnthropicMessage
    const text = data.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text!)
      .join('')
      .trim()

    if (!text) throw new Error('empty text block in Anthropic response')

    // [LAW:types-are-the-program] Parse the LLM JSON at the trust boundary. Haiku
    // routinely wraps the object in a ```json … ``` markdown fence despite the
    // instruction not to; extracting the first balanced object tolerates that (and any
    // stray preamble or trailing prose) without a brittle fence-specific strip. A throw
    // (no object present) or a Zod failure (missing/empty field) drops to the
    // catch's deterministic fallback — same as an HTTP error.
    const jsonSlice = extractFirstJsonObject(text)
    // Log a bounded snippet + length, not the whole response: it is re-logged via
    // console.error below and an unbounded model dump bloats logs and over-exposes output.
    if (jsonSlice === null) {
      throw new Error(`no JSON object in Anthropic response (len ${text.length}): ${text.slice(0, 120)}`)
    }
    const composed = composedSlopSchema.parse(JSON.parse(jsonSlice))

    // Hard-truncate as a safeguard: the instructions target the model, but we own
    // the constraints and must not pass an over-length prompt to defaultParamsForRecipe
    // / paramsSchema, nor an over-long placard to the card. [LAW:one-source-of-truth]
    // capPrompt / capPlacard are the shared length enforcers, identical to the
    // fallback path.
    emit('slopspot.composer.result', { outcome: 'haiku' }, 1)
    return { prompt: capPrompt(composed.prompt), title: capPlacard(composed.title) }
  } catch (err) {
    // [LAW:no-silent-fallbacks][LAW:dataflow-not-control-flow] The status carried on
    // the thrown value selects the reason — a dead/expired key (401/403) is the loud,
    // operator-actionable `auth_error`; everything else (transient 5xx, timeout,
    // network throw, malformed JSON) is the self-healing `api_error`. The fallback
    // itself is unchanged: composition still degrades to the recipe-only pair.
    const reason =
      err instanceof AnthropicHttpError && (err.status === 401 || err.status === 403)
        ? 'auth_error'
        : 'api_error'
    console.error('composer: Haiku call failed; using recipe fallback (prompt + title)', {
      styleFamily,
      subjectTemplate: subject.subjectTemplate,
      reason,
      err,
    })
    emit('slopspot.composer.result', { outcome: 'fallback', reason }, 1)
    return fallback
  } finally {
    clearTimeout(timeoutId)
  }
}
