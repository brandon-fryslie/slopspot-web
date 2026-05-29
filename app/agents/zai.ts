// [LAW:single-enforcer] The only module that calls the z.ai API. Every
// persona action (vote, discover, generate) funnels through chat() — no
// direct fetch() to z.ai elsewhere.
//
// [LAW:no-shared-mutable-globals] No singleton client; the fetch is
// constructed per-call from env (Workers-runtime idiom — env is
// request-scoped and the API key is read fresh each call).
//
// z.ai exposes an OpenAI-compatible chat completions endpoint. Vision is
// supported via image_url content parts on the user message. If vision is
// not available for the configured model, the same call falls back to
// text-only by omitting the image_url part.

import type { Persona } from './persona'

// The z.ai OpenAI-compatible base URL.
const ZAI_BASE = 'https://api.z.ai/v1'

// Error body is capped to keep log lines readable — z.ai can return HTML pages
// or verbose JSON error objects on failure paths.
const MAX_ERROR_BODY = 500

// [LAW:types-are-the-program] system role is excluded — callers cannot inject
// a system message; the persona prompt is always the only system message.
// Admitting 'system' here would make the contract ambiguous and allow callers
// to accidentally override or duplicate the persona context.
export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ChatInput = {
  persona: Persona
  messages: ChatMessage[]
  vision?: {
    /** URL the model can fetch (http/https), or a data: URI for base64 content. */
    imageUrl: string
  }
}

// [LAW:types-are-the-program] The response is always a string (the model's
// reply). Callers map it to their domain type (vote decision, discovery
// judgement, etc.) — zai.ts has no opinion on what the string means.
export async function chat(input: ChatInput, env: Env): Promise<string> {
  const { persona, messages, vision } = input

  const apiKey = env.SLOPSPOT_ZAI_API_KEY
  if (!apiKey) {
    throw new ZaiError('SLOPSPOT_ZAI_API_KEY is not set', 500)
  }

  // System message is the persona prompt; user messages follow.
  const apiMessages: ZaiMessage[] = [
    { role: 'system', content: persona.personaPrompt },
    ...messages.map((m): ZaiMessage => {
      if (m.role === 'user' && vision) {
        return {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: vision.imageUrl } },
            { type: 'text', text: m.content },
          ],
        }
      }
      return { role: m.role, content: m.content }
    }),
  ]

  const response = await fetch(`${ZAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: persona.modelId,
      messages: apiMessages,
    }),
  })

  if (!response.ok) {
    const raw = await response.text().catch(() => '(unreadable body)')
    const body = raw.length > MAX_ERROR_BODY ? raw.slice(0, MAX_ERROR_BODY) + '…' : raw
    throw new ZaiError(
      `z.ai request failed: ${response.status} ${response.statusText} — ${body}`,
      response.status,
    )
  }

  let json: ZaiCompletionResponse
  try {
    json = (await response.json()) as ZaiCompletionResponse
  } catch {
    throw new ZaiError('z.ai returned a non-JSON response', 502)
  }

  const content = json.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.length === 0) {
    throw new ZaiError('z.ai response missing content', 502)
  }
  return content
}

export class ZaiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
    this.name = 'ZaiError'
  }
}

// Internal wire types — not exported. Callers speak domain types (ChatInput);
// these exist only to satisfy the fetch body shape.
type ZaiTextContent = { type: 'text'; text: string }
type ZaiImageContent = { type: 'image_url'; image_url: { url: string } }
type ZaiMessage =
  | { role: 'system' | 'assistant'; content: string }
  | { role: 'user'; content: string | (ZaiTextContent | ZaiImageContent)[] }

type ZaiCompletionResponse = {
  choices?: Array<{
    message?: { content?: string }
  }>
}
