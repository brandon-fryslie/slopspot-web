// OpenAI vision judgment. Called by judgeImage() in zai.ts when the configured
// provider is 'openai'. Not imported directly by the pipeline.
//
// [LAW:single-enforcer] All OpenAI calls in this service go through
// judgeImageOpenAi — the fetch and response parsing happen exactly once, here.
//
// Model is runtime-configurable via OPENAI_MODEL env var. The GPT-4o-mini
// default is known-good for vision; set OPENAI_MODEL to target a different
// model in the GPT-4 / GPT-5 family.

import type { Judgment } from './zai.js'

const DEFAULT_MODEL = 'gpt-5.4-mini'

export async function judgeImageOpenAi(opts: {
  imageUrl: string
  personaPrompt: string
  apiKey: string
}): Promise<Judgment | null> {
  const model = process.env['OPENAI_MODEL'] ?? DEFAULT_MODEL

  const prompt = [
    opts.personaPrompt,
    '',
    'Rate this AI-generated image on a scale of 0 to 100 based on your aesthetic criteria.',
    'Reply with exactly two lines:',
    'Line 1: a single integer between 0 and 100.',
    'Line 2: one sentence explaining your rating.',
  ].join('\n')

  let reply: string
  try {
    reply = await callOpenAiVision({ imageUrl: opts.imageUrl, prompt, apiKey: opts.apiKey, model })
  } catch (err) {
    console.warn('voter: OpenAI vision failed', { imageUrl: opts.imageUrl, model, err: String(err) })
    return null
  }

  const lines = reply.trim().split('\n').map((l) => l.trim()).filter(Boolean)
  const scoreLine = lines[0] ?? ''
  const reasoningLine = lines[1] ?? ''

  // [LAW:types-are-the-program] Score and reasoning must both be present and
  // valid — a missing reasoning line produces null rather than synthetic text.
  const parsed = /^\d{1,3}$/.test(scoreLine) ? parseInt(scoreLine, 10) : NaN
  if (isNaN(parsed) || parsed < 0 || parsed > 100 || !reasoningLine) {
    console.warn('voter: unparseable response from OpenAI', { model, reply: reply.slice(0, 200) })
    return null
  }
  return { score: parsed, reasoning: reasoningLine }
}

async function callOpenAiVision(opts: {
  imageUrl: string
  prompt: string
  apiKey: string
  model: string
}): Promise<string> {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: opts.prompt },
            { type: 'image_url', image_url: { url: opts.imageUrl, detail: 'low' } },
          ],
        },
      ],
      max_tokens: 100,
    }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!resp.ok) {
    const body = await resp.text().catch(() => '(unreadable)')
    throw new Error(`OpenAI API ${resp.status}: ${body.slice(0, 200)}`)
  }

  const json = (await resp.json()) as {
    choices: Array<{ message: { content: string | null } }>
  }
  return json.choices[0]?.message?.content ?? ''
}
