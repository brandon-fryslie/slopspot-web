import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildMetaPrompt,
  callClaudeApi,
  randomEasyForm,
  randomHardForm,
  type BankEntry,
} from './bank-gen'
import { describeEasy, describeHard, type EasyForm, type HardForm } from '~/lib/forms'

// ─── buildMetaPrompt ─────────────────────────────────────────────────────────

describe('buildMetaPrompt', () => {
  const easy: EasyForm = { kind: 'word_count_modulo', divisor: 5, residue: 2 }
  const hard: HardForm = { kind: 'lipogram', forbidden: 'e' }

  it('contains both describe() outputs', () => {
    const prompt = buildMetaPrompt(easy, hard)
    expect(prompt).toContain(describeEasy(easy))
    expect(prompt).toContain(describeHard(hard))
  })

  it('mentions the 240s TTL', () => {
    const prompt = buildMetaPrompt(easy, hard)
    expect(prompt).toContain('240')
  })

  it('instructs that no acknowledgement field exists', () => {
    const prompt = buildMetaPrompt(easy, hard)
    expect(prompt.toLowerCase()).toContain('no acknowledgement field')
  })

  it('returns a non-empty string for all hard form variants', () => {
    const hardForms: HardForm[] = [
      { kind: 'lipogram', forbidden: 'e' },
      { kind: 'acrostic', target: 'SLOP' },
      { kind: 'every_word_unique_first_letter' },
      { kind: 'embedded_palindrome', minLength: 3 },
      { kind: 'pangram' },
      { kind: 'every_word_ends_with', suffix: 'ing' },
      { kind: 'word_lengths_strictly_increasing' },
      { kind: 'no_word_repeats' },
      { kind: 'every_word_starts_same_letter', letter: 's' },
      { kind: 'haiku' },
      { kind: 'monosyllabic' },
      { kind: 'iambic_pentameter', lines: 2 },
    ]
    for (const h of hardForms) {
      const prompt = buildMetaPrompt(easy, h)
      expect(prompt.length).toBeGreaterThan(50)
    }
  })
})

// ─── callClaudeApi ────────────────────────────────────────────────────────────

describe('callClaudeApi', () => {
  const FAKE_KEY = 'sk-test-key'

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockFetch(status: number, body: unknown) {
    const mockedFetch = vi.mocked(fetch)
    mockedFetch.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as Response)
  }

  it('returns text from a successful response', async () => {
    mockFetch(200, {
      content: [{ type: 'text', text: '  Hello, SlopSpot briefing!  ' }],
    })
    const result = await callClaudeApi('test prompt', FAKE_KEY)
    expect(result).toBe('Hello, SlopSpot briefing!')
  })

  it('throws on non-2xx status', async () => {
    mockFetch(429, { error: { message: 'rate limit exceeded' } })
    await expect(callClaudeApi('test prompt', FAKE_KEY)).rejects.toThrow('429')
  })

  it('throws on empty content array', async () => {
    mockFetch(200, { content: [] })
    await expect(callClaudeApi('test prompt', FAKE_KEY)).rejects.toThrow(
      'No text block in Anthropic response',
    )
  })

  it('throws when content has no text block', async () => {
    mockFetch(200, { content: [{ type: 'tool_use', id: 'x' }] })
    await expect(callClaudeApi('test prompt', FAKE_KEY)).rejects.toThrow(
      'No text block in Anthropic response',
    )
  })

  it('sends correct API headers and model', async () => {
    mockFetch(200, { content: [{ type: 'text', text: 'ok' }] })
    await callClaudeApi('my prompt', FAKE_KEY)

    const mockedFetch = vi.mocked(fetch)
    const [url, opts] = mockedFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const headers = opts.headers as Record<string, string>
    expect(headers['x-api-key']).toBe(FAKE_KEY)
    expect(headers['anthropic-version']).toBe('2023-06-01')

    const body = JSON.parse(opts.body as string) as { model: string; messages: unknown[] }
    expect(body.model).toMatch(/^claude-/)
    expect(body.messages).toHaveLength(1)
  })
})

// ─── randomEasyForm / randomHardForm ─────────────────────────────────────────

describe('randomEasyForm', () => {
  it('returns a valid EasyForm with a kind property', () => {
    for (let i = 0; i < 20; i++) {
      const form = randomEasyForm()
      expect(form).toHaveProperty('kind')
      // describeEasy must not throw — this validates the params are in-range
      expect(() => describeEasy(form)).not.toThrow()
    }
  })
})

describe('randomHardForm', () => {
  it('returns a valid HardForm with a kind property', () => {
    for (let i = 0; i < 20; i++) {
      const form = randomHardForm()
      expect(form).toHaveProperty('kind')
      expect(() => describeHard(form)).not.toThrow()
    }
  })
})

// ─── BankEntry shape ──────────────────────────────────────────────────────────

describe('BankEntry shape', () => {
  it('buildMetaPrompt + randomForms produce a valid BankEntry-shaped object', () => {
    const easy = randomEasyForm()
    const hard = randomHardForm()
    const entry: BankEntry = {
      id: crypto.randomUUID(),
      briefing_text: buildMetaPrompt(easy, hard),
      easy_form: easy,
      hard_form: hard,
      generated_at: Date.now(),
    }
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(entry.briefing_text.length).toBeGreaterThan(0)
    expect(entry.easy_form.kind).toBeTruthy()
    expect(entry.hard_form.kind).toBeTruthy()
    expect(entry.generated_at).toBeGreaterThan(0)
  })
})
