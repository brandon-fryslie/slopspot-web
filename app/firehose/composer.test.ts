// [LAW:behavior-not-structure] Tests pin the contract of composePrompt:
//   - Happy path: the one Haiku call returns JSON {title, prompt}; both are parsed
//     and returned (trimmed).
//   - Placard: the meta-prompt asks for a title, and the parsed title is returned.
//   - Fallback path: when the call fails (throws / non-OK / missing key / malformed
//     JSON), BOTH halves fall back together — prompt to renderTemplate output, title
//     to the deterministic fallbackTitle placard.
//   - promptPrefix inclusion: meta-prompt includes the persona's voice when set.
//   - wish steering: the wish steers the meta-prompt but is never the returned
//     prompt, never reaches the recipe-only fallback, and is capped before embed.
//   - Truncation: prompt to maxLength, title to its own cap.
//   - Metric: slopspot.composer.result emitted with correct outcome/reason.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fallbackTitle,
  PLACARD_TITLE_MAX,
  recipeSubjectSchema,
  renderTemplate,
  STYLE_FAMILY_PROMPT_SEEDS,
} from '~/lib/variety'
import { composePrompt, type ComposerInput } from './composer'

vi.mock('~/observability/metrics', () => ({ emit: vi.fn() }))
import { emit } from '~/observability/metrics'

function mockEnv(apiKey: string | undefined): Env {
  return { SLOPSPOT_ANTHROPIC_API_KEY: apiKey } as unknown as Env
}

function makeInput(overrides: Partial<ComposerInput> = {}): ComposerInput {
  const subject = recipeSubjectSchema.parse({
    subjectTemplate: 'T01',
    slots: { animal: 'cat', profession: 'surgeon' },
  })
  return {
    styleFamily: 'photoreal',
    subject,
    aspectRatio: '1:1',
    ...overrides,
  }
}

// The Haiku response shape: one text block whose body is the JSON the composer parses.
function jsonResponse(title: string, prompt: string): Response {
  return {
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ title, prompt }) }] }),
  } as Response
}

function expectedFallback(input: ComposerInput) {
  const raw = input.promptPrefix
    ? `${input.promptPrefix}, ${renderTemplate(input.subject)}, ${STYLE_FAMILY_PROMPT_SEEDS[input.styleFamily]}`
    : `${renderTemplate(input.subject)}, ${STYLE_FAMILY_PROMPT_SEEDS[input.styleFamily]}`
  // Mirror the composer: the fallback prompt respects maxLength too, not only the
  // Haiku-success path.
  const prompt =
    input.maxLength && raw.length > input.maxLength ? raw.slice(0, input.maxLength) : raw
  return { prompt, title: fallbackTitle(input.subject) }
}

describe('composePrompt', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.mocked(emit).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the parsed prompt AND placard title when the call succeeds', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse('The Cursed One', 'A weathered surgeon cat under harsh fluorescent lighting'),
    )

    const result = await composePrompt(makeInput(), mockEnv('test-key'))
    expect(result).toEqual({
      title: 'The Cursed One',
      prompt: 'A weathered surgeon cat under harsh fluorescent lighting',
    })
    expect(emit).toHaveBeenCalledWith('slopspot.composer.result', { outcome: 'haiku' }, 1)
  })

  it('asks Haiku for a placard title in the meta-prompt', async () => {
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('A Name', 'a prompt')
    })

    await composePrompt(makeInput(), mockEnv('test-key'))
    expect(capturedBody).toContain('placard')
  })

  it('falls back (prompt + title together) when fetch throws', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network error'))

    const input = makeInput()
    const result = await composePrompt(input, mockEnv('test-key'))
    expect(result).toEqual(expectedFallback(input))
    expect(emit).toHaveBeenCalledWith(
      'slopspot.composer.result',
      { outcome: 'fallback', reason: 'api_error' },
      1,
    )
  })

  it('falls back when Anthropic returns a non-OK status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    } as Response)

    const input = makeInput()
    const result = await composePrompt(input, mockEnv('test-key'))
    expect(result).toEqual(expectedFallback(input))
    expect(emit).toHaveBeenCalledWith(
      'slopspot.composer.result',
      { outcome: 'fallback', reason: 'api_error' },
      1,
    )
  })

  it('tolerates a markdown-fenced JSON response (Haiku wraps it despite instructions)', async () => {
    const fenced = '```json\n{"title":"Fenced Name","prompt":"a fenced prompt"}\n```'
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: fenced }] }),
    } as Response)

    const result = await composePrompt(makeInput(), mockEnv('test-key'))
    expect(result).toEqual({ title: 'Fenced Name', prompt: 'a fenced prompt' })
    expect(emit).toHaveBeenCalledWith('slopspot.composer.result', { outcome: 'haiku' }, 1)
  })

  it('extracts the object even when a string contains braces and prose trails it', async () => {
    // The prompt value contains { and }, and the model appends commentary after the
    // object. A first-brace-to-last-brace slice would grab the trailing brace; the
    // balanced scanner extracts the complete object.
    const body =
      '{"title":"The {Cursed} One","prompt":"a sign reading {OPEN} at 3am"}\n\nHope that works! }'
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: body }] }),
    } as Response)

    const result = await composePrompt(makeInput(), mockEnv('test-key'))
    expect(result).toEqual({ title: 'The {Cursed} One', prompt: 'a sign reading {OPEN} at 3am' })
  })

  it('falls back when the Haiku response has no JSON object at all', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'just a bare prompt, no JSON' }] }),
    } as Response)

    const input = makeInput()
    const result = await composePrompt(input, mockEnv('test-key'))
    expect(result).toEqual(expectedFallback(input))
    expect(emit).toHaveBeenCalledWith(
      'slopspot.composer.result',
      { outcome: 'fallback', reason: 'api_error' },
      1,
    )
  })

  it('falls back when the JSON has a present-but-empty title', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse('', 'a fine prompt'))

    const input = makeInput()
    const result = await composePrompt(input, mockEnv('test-key'))
    expect(result).toEqual(expectedFallback(input))
  })

  it('falls back when SLOPSPOT_ANTHROPIC_API_KEY is absent (no fetch call)', async () => {
    const input = makeInput()
    const result = await composePrompt(input, mockEnv(undefined))
    expect(result).toEqual(expectedFallback(input))
    expect(fetch).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(
      'slopspot.composer.result',
      { outcome: 'fallback', reason: 'missing_key' },
      1,
    )
  })

  it('the fallback title is a deterministic placard, never empty, never the prompt', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('down'))
    const input = makeInput()
    const result = await composePrompt(input, mockEnv('test-key'))
    expect(result.title.length).toBeGreaterThan(0)
    expect(result.title).not.toBe(result.prompt)
    expect(result.title).toBe(fallbackTitle(input.subject))
  })

  it('promptPrefix (the persona voice) is prepended in the fallback prompt', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('down'))
    const input = makeInput({ promptPrefix: 'ethereal, dreamlike' })
    const result = await composePrompt(input, mockEnv('test-key'))
    expect(result.prompt.startsWith('ethereal, dreamlike,')).toBe(true)
  })

  it('promptPrefix (the persona voice) is included in the Haiku meta-prompt body', async () => {
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('A Name', 'ethereal generated prompt')
    })

    await composePrompt(makeInput({ promptPrefix: 'gritty noir' }), mockEnv('test-key'))
    expect(capturedBody).toContain('gritty noir')
  })

  // [RECONCILE B] The wish is provenance the composer READS to steer Haiku — the
  // returned prompt is always the machine's authorship, never the raw wish.
  it('wish-seeded composition steers the meta-prompt but returns the machine prompt, not the wish', async () => {
    const wish = 'a cozy cottage by a quiet lake at dawn'
    const machinePrompt = 'A fractured neon cathedral devouring a lake, signage everywhere'
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('Lakeside Heresy', machinePrompt)
    })

    const result = await composePrompt(makeInput({ occasion: { kind: 'wish', wish } }), mockEnv('test-key'))

    expect(capturedBody).toContain(wish)
    expect(result.prompt).toBe(machinePrompt)
    expect(result.prompt).not.toContain(wish)
  })

  it('a wish never reaches the recipe-only fallback when Haiku is unavailable', async () => {
    const wish = 'a cozy cottage by a quiet lake at dawn'
    vi.mocked(fetch).mockRejectedValueOnce(new Error('down'))

    const input = makeInput({ occasion: { kind: 'wish', wish }, promptPrefix: 'austere' })
    const result = await composePrompt(input, mockEnv('test-key'))

    // [LAW:dataflow-not-control-flow] The wish has no authoring path but Haiku;
    // the fallback is recipe-only, so the human's words cannot leak verbatim.
    expect(result.prompt).not.toContain(wish)
    expect(result).toEqual(expectedFallback(input))
  })

  it('caps an over-long wish before embedding it in the Haiku request', async () => {
    const head = 'A'.repeat(1000)
    const tail = 'B'.repeat(4000)
    const wish = head + tail
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('Capped', 'ok')
    })

    await composePrompt(makeInput({ occasion: { kind: 'wish', wish } }), mockEnv('test-key'))
    expect(capturedBody).toContain(head)
    expect(capturedBody).not.toContain(tail)
  })

  // The self-portrait occasion (roll-call-47p.6) swaps the DEPICTION to the citizen
  // itself; the recipe subject no longer drives what Haiku is told to render.
  it('a self-portrait occasion depicts the citizen, not the recipe subject', async () => {
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('A Stark Face', 'a figure in an empty hallway')
    })

    const input = makeInput({ occasion: { kind: 'self-portrait', displayName: 'GutterMonk' } })
    await composePrompt(input, mockEnv('test-key'))

    // The meta-prompt depicts GutterMonk's self-portrait, not the recipe's subject.
    expect(capturedBody).toContain('self-portrait of GutterMonk')
    expect(capturedBody).not.toContain(renderTemplate(input.subject))
  })

  // On the Haiku-failure fallback, the placard must track the depiction — a
  // self-portrait is named for the citizen, not the recipe's subject, so the image
  // and its title never describe different things.
  it('the self-portrait fallback title names the citizen, not the recipe subject', async () => {
    const input = makeInput({ occasion: { kind: 'self-portrait', displayName: 'GutterMonk' } })
    const result = await composePrompt(input, mockEnv(undefined)) // no key → fallback

    expect(result.title).toBe('GutterMonk')
    expect(result.title).not.toBe(fallbackTitle(input.subject))
  })

  it('trims leading/trailing whitespace from the parsed prompt and title', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse('  Padded Name  ', '  padded response  '))

    const result = await composePrompt(makeInput(), mockEnv('test-key'))
    expect(result.prompt).toBe('padded response')
    expect(result.title).toBe('Padded Name')
  })

  it('truncates the prompt to maxLength if it exceeds it', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse('A Name', 'x'.repeat(600)))

    const result = await composePrompt(makeInput({ maxLength: 500 }), mockEnv('test-key'))
    expect(result.prompt).toHaveLength(500)
  })

  it('truncates the FALLBACK prompt to maxLength too (not only the Haiku path)', async () => {
    // A long persona voice forces the recipe-only fallback prompt over a small cap;
    // the fallback must still respect maxLength or downstream params validation fails.
    vi.mocked(fetch).mockRejectedValueOnce(new Error('down'))
    const input = makeInput({ promptPrefix: 'x'.repeat(300), maxLength: 120 })
    const result = await composePrompt(input, mockEnv('test-key'))
    expect(result.prompt.length).toBeLessThanOrEqual(120)
    expect(result).toEqual(expectedFallback(input))
  })

  it('does not truncate the prompt when within maxLength', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse('A Name', 'x'.repeat(400)))

    const result = await composePrompt(makeInput({ maxLength: 500 }), mockEnv('test-key'))
    expect(result.prompt).toHaveLength(400)
  })

  it('truncates an over-long title to its own cap', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse('N'.repeat(200), 'a prompt'))

    const result = await composePrompt(makeInput(), mockEnv('test-key'))
    expect(result.title.length).toBeLessThanOrEqual(PLACARD_TITLE_MAX)
  })

  it('maxLength is included as a constraint in the meta-prompt sent to Haiku', async () => {
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('A Name', 'ok')
    })

    await composePrompt(makeInput({ maxLength: 500 }), mockEnv('test-key'))
    expect(capturedBody).toContain('500')
  })
})
