// [LAW:behavior-not-structure] These tests pin the wire-shape contract of
// zai.chat — what the function sends and how it maps the response. The test
// does NOT hit the real z.ai network; it mocks fetch to verify the wire shape
// so changes to the HTTP contract surface here, not silently in prod.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { chat, ZaiError } from './zai'
import type { Persona } from './persona'
import { AgentId } from '~/lib/domain'

const STUB_PERSONA: Persona = {
  agentId: AgentId('agent:test'),
  displayName: 'Test Persona',
  role: 'voter',
  personaPrompt: 'You are a test voter.',
  modelId: 'glm-4v-flash',
  config: { upvoteThreshold: 70 },
}

const STUB_ENV = {
  SLOPSPOT_ZAI_API_KEY: 'test-key-abc',
} as unknown as Env

function okResponse(content: string) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('zai.chat', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sends the persona prompt as system message + user messages', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      okResponse('upvote'),
    )

    await chat(
      {
        persona: STUB_PERSONA,
        messages: [{ role: 'user', content: 'Should I upvote this?' }],
      },
      STUB_ENV,
    )

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toContain('/chat/completions')

    const body = JSON.parse(init!.body as string)
    expect(body.model).toBe('glm-4v-flash')
    expect(body.messages[0]).toEqual({
      role: 'system',
      content: 'You are a test voter.',
    })
    expect(body.messages[1]).toEqual({
      role: 'user',
      content: 'Should I upvote this?',
    })
  })

  it('sends Authorization header with the API key', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      okResponse('ok'),
    )

    await chat({ persona: STUB_PERSONA, messages: [] }, STUB_ENV)

    const [, init] = fetchSpy.mock.calls[0]
    const headers = init!.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer test-key-abc')
  })

  it('returns the model content string', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      okResponse('this image slaps'),
    )

    const result = await chat(
      { persona: STUB_PERSONA, messages: [] },
      STUB_ENV,
    )

    expect(result).toBe('this image slaps')
  })

  it('includes image_url content part when vision is provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      okResponse('vision response'),
    )

    await chat(
      {
        persona: STUB_PERSONA,
        messages: [{ role: 'user', content: 'What do you see?' }],
        vision: { imageUrl: 'https://example.com/img.jpg' },
      },
      STUB_ENV,
    )

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    const userMsg = body.messages[1]
    expect(Array.isArray(userMsg.content)).toBe(true)
    expect(userMsg.content).toContainEqual({
      type: 'image_url',
      image_url: { url: 'https://example.com/img.jpg' },
    })
    expect(userMsg.content).toContainEqual({
      type: 'text',
      text: 'What do you see?',
    })
  })

  it('throws ZaiError on non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    )

    await expect(
      chat({ persona: STUB_PERSONA, messages: [] }, STUB_ENV),
    ).rejects.toThrow(ZaiError)
  })

  it('ZaiError carries the HTTP status code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Rate limited', { status: 429 }),
    )

    const err = await chat({ persona: STUB_PERSONA, messages: [] }, STUB_ENV).catch((e) => e)
    expect(err).toBeInstanceOf(ZaiError)
    expect((err as ZaiError).statusCode).toBe(429)
  })

  it('throws ZaiError when response has no content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(
      chat({ persona: STUB_PERSONA, messages: [] }, STUB_ENV),
    ).rejects.toThrow(ZaiError)
  })

  it('throws ZaiError when API key is not set', async () => {
    const envWithoutKey = {} as unknown as Env

    await expect(
      chat({ persona: STUB_PERSONA, messages: [] }, envWithoutKey),
    ).rejects.toThrow(ZaiError)
  })

  it('truncates long error body to MAX_ERROR_BODY chars', async () => {
    const longBody = 'x'.repeat(2000)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(longBody, { status: 500 }),
    )

    const err = await chat({ persona: STUB_PERSONA, messages: [] }, STUB_ENV).catch((e) => e)
    expect(err).toBeInstanceOf(ZaiError)
    // message should end with '…' indicating truncation
    expect((err as ZaiError).message).toContain('…')
    // should not include the full body
    expect((err as ZaiError).message.length).toBeLessThan(longBody.length)
  })

  it('throws ZaiError (not SyntaxError) when 2xx response is non-JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>Not JSON</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    )

    const err = await chat({ persona: STUB_PERSONA, messages: [] }, STUB_ENV).catch((e) => e)
    expect(err).toBeInstanceOf(ZaiError)
    expect((err as ZaiError).statusCode).toBe(502)
  })
})
