// [LAW:behavior-not-structure] These tests pin the SSE-parsing contract of
// /api/rewrite-prompt — the route's core behavior is transforming an Anthropic
// SSE stream into a flat text/plain stream. They are deliberately blind to
// internal variable names; only the output text and status codes matter.
//
// [LAW:verifiable-goals] The key edge cases are chunk-splitting across line
// boundaries and EOF flushing of buffered remainder bytes. These are the exact
// bugs Copilot flagged in review — the tests would have caught them pre-merge.

import { describe, expect, it, vi, afterEach } from 'vitest'
import { env } from 'cloudflare:test'
import { action } from '~/routes/api.rewrite-prompt'
import { REWRITE_DELIMITER } from '~/lib/rewrite-delim'

const stubCtx: ExecutionContext = {
  waitUntil() {},
  passThroughOnException() {},
  exports: {} as Cloudflare.Exports,
  props: {},
}

function actionArgs(body: object, origin = 'https://slopspot.ai'): Parameters<typeof action>[0] {
  const url = new URL('https://slopspot.ai/api/rewrite-prompt')
  return {
    params: {},
    context: { cloudflare: { env: { ...env, SLOPSPOT_ANTHROPIC_API_KEY: 'sk-test' }, ctx: stubCtx } },
    request: new Request(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', origin },
    }),
    url,
    pattern: '/api/rewrite-prompt',
  } as Parameters<typeof action>[0]
}

// Builds a ReadableStream that emits the provided byte chunks synchronously.
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

// Builds a valid Anthropic SSE line for a text_delta event.
function textDeltaLine(text: string): string {
  return `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n`
}

const MOCK_SSE_DONE = 'data: [DONE]\n'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('api.rewrite-prompt SSE parsing', () => {
  it('streams thinking prose + rewritten prompt from well-formed SSE chunks', async () => {
    const thinkingText = `I'm reaching for something theatrical here.\n`
    const promptText = 'A vivid oil painting of the subject.'

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(sseStream([
        textDeltaLine(thinkingText),
        textDeltaLine(`${REWRITE_DELIMITER}\n`),
        textDeltaLine(promptText),
        MOCK_SSE_DONE,
      ]), { status: 200 })
    ))

    const res = await action(actionArgs({ prompt: 'a dog', styleFamily: 'oil-painting', aspectRatio: '1:1' }))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain(thinkingText.trim())
    expect(text).toContain(`${REWRITE_DELIMITER}\n`)
    expect(text).toContain(promptText)
  })

  it('handles SSE line boundaries split across chunks', async () => {
    // Split a data: line mid-way across two chunks — the core edge case.
    const fullLine = textDeltaLine('hello world')
    const mid = Math.floor(fullLine.length / 2)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(sseStream([
        fullLine.slice(0, mid),
        fullLine.slice(mid),
        MOCK_SSE_DONE,
      ]), { status: 200 })
    ))

    const res = await action(actionArgs({ prompt: 'a cat', styleFamily: 'low-poly', aspectRatio: '16:9' }))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toBe('hello world')
  })

  it('handles a final SSE line with no trailing newline (EOF flush)', async () => {
    // The last data: line lacks a trailing \n — exercises the EOF lineBuffer flush.
    const line = textDeltaLine('final chunk').trimEnd() // strip the \n

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(sseStream([line]), { status: 200 })
    ))

    const res = await action(actionArgs({ prompt: 'a fish', styleFamily: 'watercolor', aspectRatio: '4:3' }))
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toBe('final chunk')
  })

  it('returns 405 for non-POST methods', async () => {
    const url = new URL('https://slopspot.ai/api/rewrite-prompt')
    const res = await action({
      params: {},
      context: { cloudflare: { env: { ...env, SLOPSPOT_ANTHROPIC_API_KEY: 'sk-test' }, ctx: stubCtx } },
      request: new Request(url, { method: 'GET' }),
      url,
      pattern: '/api/rewrite-prompt',
    } as Parameters<typeof action>[0])
    expect(res.status).toBe(405)
  })

  it('returns 400 for invalid body', async () => {
    const res = await action(actionArgs({ prompt: '' }))
    expect(res.status).toBe(400)
  })

  it('returns 500 when Anthropic key is missing', async () => {
    const url = new URL('https://slopspot.ai/api/rewrite-prompt')
    const res = await action({
      params: {},
      context: { cloudflare: { env: { ...env, SLOPSPOT_ANTHROPIC_API_KEY: '' }, ctx: stubCtx } },
      request: new Request(url, {
        method: 'POST',
        body: JSON.stringify({ prompt: 'test', styleFamily: 'oil-painting', aspectRatio: '1:1' }),
        headers: { 'content-type': 'application/json', origin: 'https://slopspot.ai' },
      }),
      url,
      pattern: '/api/rewrite-prompt',
    } as Parameters<typeof action>[0])
    expect(res.status).toBe(500)
  })

  it('returns 502 when Anthropic responds non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{"error":"unauthorized"}', { status: 401 })
    ))

    const res = await action(actionArgs({ prompt: 'a bird', styleFamily: 'low-poly', aspectRatio: '9:16' }))
    expect(res.status).toBe(502)
  })
})
