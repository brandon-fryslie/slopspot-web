// OpenAI vision judgment. Called by judgeCandidate() in zai.ts when the
// configured provider is 'openai'. Not imported directly by the pipeline.
//
// [LAW:single-enforcer] All OpenAI calls in this service go through
// judgeCandidateOpenAi — the file read, encoding, fetch, and response
// parsing happen exactly once, here.
//
// Model is runtime-configurable via OPENAI_MODEL env var. The GPT-4o-mini
// default is known-good for vision; set OPENAI_MODEL to target a different
// model in the GPT-4 / GPT-5 family.
//
// imageUrl is a local file path (/tmp/slopspot-*.jpeg) — the pipeline
// downloads images to temp files before judging (CDN redirect safety).
// We base64-encode and send as a data URI so OpenAI never needs to fetch
// anything externally from the Nomad container.

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { JudgmentResult } from './zai.js'

const DEFAULT_MODEL = 'gpt-4o-mini'

const MIME: Record<string, string> = {
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

export async function judgeCandidateOpenAi(opts: {
  imageUrl: string   // local file path
  pageUrl: string
  title: string
  personaPrompt: string
  apiKey: string
}): Promise<JudgmentResult | null> {
  const model = process.env['OPENAI_MODEL'] ?? DEFAULT_MODEL

  const prompt = [
    opts.personaPrompt,
    '',
    `You are reviewing an AI-generated image found at: ${opts.pageUrl}`,
    `Title: ${opts.title}`,
    '',
    'Score this image from 0 to 100 based on how interesting, surprising, or compelling it is as AI-generated content for SlopSpot.',
    '',
    'Respond with ONLY:',
    '- First line: a single integer (0–100)',
    '- Second line (optional): a one-sentence reaction in your persona voice',
  ].join('\n')

  let dataUri: string
  try {
    dataUri = await toDataUri(opts.imageUrl)
  } catch (err) {
    console.warn('discoverer: OpenAI image read failed', { imageUrl: opts.imageUrl, err: String(err) })
    return null
  }

  let reply: string
  try {
    reply = await callOpenAiVision({ dataUri, prompt, apiKey: opts.apiKey, model })
  } catch (err) {
    console.warn('discoverer: OpenAI vision failed', { pageUrl: opts.pageUrl, model, err: String(err) })
    return null
  }

  const lines = reply.trim().split('\n')
  const score = parseInt(lines[0]?.trim() ?? '', 10)
  if (isNaN(score) || score < 0 || score > 100) {
    console.warn('discoverer: unparseable score from OpenAI', { model, reply: reply.slice(0, 200) })
    return null
  }
  const reaction = lines[1]?.trim() ?? ''
  return { score, reaction }
}

async function toDataUri(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase()
  const mime = MIME[ext] ?? 'image/jpeg'
  const buf = await readFile(filePath)
  return `data:${mime};base64,${buf.toString('base64')}`
}

async function callOpenAiVision(opts: {
  dataUri: string
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
            { type: 'image_url', image_url: { url: opts.dataUri, detail: 'low' } },
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
