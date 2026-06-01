// [LAW:behavior-not-structure] Tests pin the contract of composePrompt:
//   - Happy path: Haiku response string is returned verbatim (trimmed).
//   - Fallback path: when Anthropic fetch throws, returns renderTemplate output.
//   - promptPrefix inclusion: meta-prompt includes the persona's voice when set.
//   - wish steering: the wish steers the meta-prompt but is never the returned
//     prompt, never reaches the recipe-only fallback, and is capped before embed.
//   - Missing API key: falls back without calling Anthropic.
//   - Metric: slopspot.composer.result emitted with correct outcome/reason.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recipeSubjectSchema, renderTemplate, STYLE_FAMILY_PROMPT_SEEDS } from '~/lib/variety'
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

describe('composePrompt', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.mocked(emit).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the Haiku response text when the call succeeds', async () => {
    const mockText = 'A weathered surgeon cat under harsh fluorescent lighting'
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: mockText }],
      }),
    } as Response)

    const result = await composePrompt(makeInput(), mockEnv('test-key'))
    expect(result).toBe(mockText)
    expect(emit).toHaveBeenCalledWith('slopspot.composer.result', { outcome: 'haiku' }, 1)
  })

  it('falls back to renderTemplate output when fetch throws', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network error'))

    const input = makeInput()
    const result = await composePrompt(input, mockEnv('test-key'))
    const expected = `${renderTemplate(input.subject)}, ${STYLE_FAMILY_PROMPT_SEEDS[input.styleFamily]}`
    expect(result).toBe(expected)
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
    const expected = `${renderTemplate(input.subject)}, ${STYLE_FAMILY_PROMPT_SEEDS[input.styleFamily]}`
    expect(result).toBe(expected)
    expect(emit).toHaveBeenCalledWith(
      'slopspot.composer.result',
      { outcome: 'fallback', reason: 'api_error' },
      1,
    )
  })

  it('falls back when SLOPSPOT_ANTHROPIC_API_KEY is absent (no fetch call)', async () => {
    const input = makeInput()
    const result = await composePrompt(input, mockEnv(undefined))
    const expected = `${renderTemplate(input.subject)}, ${STYLE_FAMILY_PROMPT_SEEDS[input.styleFamily]}`
    expect(result).toBe(expected)
    expect(fetch).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(
      'slopspot.composer.result',
      { outcome: 'fallback', reason: 'missing_key' },
      1,
    )
  })

  it('promptPrefix (the persona voice) is prepended in the fallback output', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('down'))
    const input = makeInput({ promptPrefix: 'ethereal, dreamlike' })
    const result = await composePrompt(input, mockEnv('test-key'))
    expect(result.startsWith('ethereal, dreamlike,')).toBe(true)
  })

  it('promptPrefix (the persona voice) is included in the Haiku meta-prompt body', async () => {
    const mockText = 'ethereal generated prompt'
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return {
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: mockText }] }),
      } as Response
    })

    await composePrompt(makeInput({ promptPrefix: 'gritty noir' }), mockEnv('test-key'))
    expect(capturedBody).toContain('gritty noir')
  })

  // [RECONCILE B] The wish is provenance the composer READS to steer Haiku — the
  // returned prompt is always the machine's authorship, never the raw wish. These
  // pin that isolation behaviorally: the wish steers the meta-prompt, the returned
  // prompt is Haiku's, and a raw wish never reaches the recipe-only fallback.
  it('wish-seeded composition steers the meta-prompt but returns the machine prompt, not the wish', async () => {
    const wish = 'a cozy cottage by a quiet lake at dawn'
    const mockText = 'A fractured neon cathedral devouring a lake, signage everywhere'
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return {
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: mockText }] }),
      } as Response
    })

    const result = await composePrompt(makeInput({ wish }), mockEnv('test-key'))

    // The wish steers Haiku: it is present in the meta-prompt sent upstream.
    expect(capturedBody).toContain(wish)
    // …but the returned prompt is Haiku's authorship, NOT the verbatim wish.
    expect(result).toBe(mockText)
    expect(result).not.toBe(wish)
    expect(result).not.toContain(wish)
  })

  it('a wish never reaches the recipe-only fallback when Haiku is unavailable', async () => {
    const wish = 'a cozy cottage by a quiet lake at dawn'
    vi.mocked(fetch).mockRejectedValueOnce(new Error('down'))

    const input = makeInput({ wish, promptPrefix: 'austere' })
    const result = await composePrompt(input, mockEnv('test-key'))

    // [LAW:dataflow-not-control-flow] The wish has no authoring path but Haiku;
    // the fallback is recipe-only, so the human's words cannot leak verbatim to
    // the provider even on a composition failure.
    expect(result).not.toContain(wish)
    const expected = `austere, ${renderTemplate(input.subject)}, ${STYLE_FAMILY_PROMPT_SEEDS[input.styleFamily]}`
    expect(result).toBe(expected)
  })

  it('caps an over-long wish before embedding it in the Haiku request', async () => {
    // A 5000-char wish must not bloat the paid Anthropic call: the composer caps
    // the embedded seed at WISH_SEED_MAX (1000). The tail beyond the cap never
    // reaches the meta-prompt.
    const head = 'A'.repeat(1000)
    const tail = 'B'.repeat(4000)
    const wish = head + tail
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return {
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      } as Response
    })

    await composePrompt(makeInput({ wish }), mockEnv('test-key'))
    expect(capturedBody).toContain(head)
    expect(capturedBody).not.toContain(tail)
  })

  it('trims leading/trailing whitespace from the Haiku response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '  padded response  \n' }],
      }),
    } as Response)

    const result = await composePrompt(makeInput(), mockEnv('test-key'))
    expect(result).toBe('padded response')
  })

  it('truncates the Haiku response to maxLength if it exceeds it', async () => {
    const longText = 'x'.repeat(600)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: longText }] }),
    } as Response)

    const result = await composePrompt(makeInput({ maxLength: 500 }), mockEnv('test-key'))
    expect(result).toHaveLength(500)
  })

  it('does not truncate when response is within maxLength', async () => {
    const text = 'x'.repeat(400)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text }] }),
    } as Response)

    const result = await composePrompt(makeInput({ maxLength: 500 }), mockEnv('test-key'))
    expect(result).toHaveLength(400)
  })

  it('maxLength is included as a constraint in the meta-prompt sent to Haiku', async () => {
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return {
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      } as Response
    })

    await composePrompt(makeInput({ maxLength: 500 }), mockEnv('test-key'))
    expect(capturedBody).toContain('500')
  })
})
