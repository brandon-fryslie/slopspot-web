import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildMetaPrompt,
  callClaudeApi,
  randomEasyForm,
  randomHardForm,
  runBankGen,
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
    vi.unstubAllGlobals()
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
      // describeEasy must not throw — validates params are in-range
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

// ─── runBankGen ───────────────────────────────────────────────────────────────

function makeFakeKv() {
  const store = new Map<string, string>()
  return {
    put: vi.fn(async (key: string, value: string) => { store.set(key, value) }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    store,
  }
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    SLOPSPOT_ANTHROPIC_API_KEY: 'sk-test',
    CHALLENGE_BANK: makeFakeKv() as unknown as KVNamespace,
    ...overrides,
  } as unknown as Env
}

describe('runBankGen', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('throws when SLOPSPOT_ANTHROPIC_API_KEY is missing', async () => {
    const env = makeEnv({ SLOPSPOT_ANTHROPIC_API_KEY: '' })
    await expect(runBankGen(env)).rejects.toThrow('SLOPSPOT_ANTHROPIC_API_KEY is not configured')
  })

  it('writes entries to KV on success', async () => {
    const fakeKv = makeFakeKv()
    const env = makeEnv({ CHALLENGE_BANK: fakeKv as unknown as KVNamespace })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ content: [{ type: 'text', text: 'A SlopSpot briefing.' }] }),
        text: () => Promise.resolve(''),
      }),
    )

    await runBankGen(env, { batchSize: 5 })

    expect(fakeKv.put).toHaveBeenCalledTimes(5)
    const firstCall = fakeKv.put.mock.calls[0]
    const key = firstCall[0] as string
    const value = JSON.parse(firstCall[1] as string) as BankEntry
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(value.briefing_text).toBe('A SlopSpot briefing.')
    expect(value.easy_form.kind).toBeTruthy()
    expect(value.hard_form.kind).toBeTruthy()
  })

  it('counts failures when Claude calls fail', async () => {
    const fakeKv = makeFakeKv()
    const env = makeEnv({ CHALLENGE_BANK: fakeKv as unknown as KVNamespace })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('internal error'),
      }),
    )

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runBankGen(env, { batchSize: 5 })

    expect(fakeKv.put).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('continues when KV put fails — does not abort the batch', async () => {
    const fakeKv = makeFakeKv()
    fakeKv.put.mockRejectedValueOnce(new Error('KV transient failure'))
    const env = makeEnv({ CHALLENGE_BANK: fakeKv as unknown as KVNamespace })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ content: [{ type: 'text', text: 'briefing' }] }),
        text: () => Promise.resolve(''),
      }),
    )

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runBankGen(env, { batchSize: 3, concurrency: 1 })

    // One failure (first entry KV put threw), two successes
    expect(fakeKv.put).toHaveBeenCalledTimes(3)
    expect(consoleSpy).toHaveBeenCalledWith(
      'bank-gen: KV put failed',
      expect.objectContaining({ err: expect.any(Error) }),
    )
  })
})
