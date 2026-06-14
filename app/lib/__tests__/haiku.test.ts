// [LAW:behavior-not-structure] getAuthor contract: prod always uses the real transport; dev uses
// the deterministic fake whose response is shape-valid for each caller's parser. The selection is
// by env alone — no caller flag, no second function. The fake discriminates by prompt content.

import { describe, expect, it } from 'vitest'
import { getAuthor } from '~/lib/haiku'

function prodEnv(overrides: Partial<Env> = {}): Env {
  return { SLOPSPOT_ENV: 'prod', ...overrides } as unknown as Env
}

function devEnv(overrides: Partial<Env> = {}): Env {
  return { SLOPSPOT_ENV: 'dev', ...overrides } as unknown as Env
}

describe('getAuthor — transport selection', () => {
  it('never uses the fake when SLOPSPOT_ENV !== "dev" (prod)', async () => {
    const author = getAuthor(prodEnv({ SLOPSPOT_ANTHROPIC_API_KEY: '' }))
    // Real transport throws MissingApiKeyError when the key is absent — proves it is NOT the fake.
    await expect(author({ user: 'hello', maxTokens: 10 })).rejects.toThrow('SLOPSPOT_ANTHROPIC_API_KEY not set')
  })

  it('never uses the fake when SLOPSPOT_ENV is absent', async () => {
    const author = getAuthor({} as unknown as Env)
    // Without a key, real transport throws — fake would resolve.
    await expect(author({ user: 'hello', maxTokens: 10 })).rejects.toThrow()
  })

  it('never uses the fake when SLOPSPOT_ENV is an unexpected value', async () => {
    const author = getAuthor({ SLOPSPOT_ENV: 'staging' } as unknown as Env)
    await expect(author({ user: 'hello', maxTokens: 10 })).rejects.toThrow()
  })
})

describe('getAuthor — fake author (dev mode)', () => {
  it('returns valid persona JSON for the midwife prompt (contains "You are the MIDWIFE")', async () => {
    const author = getAuthor(devEnv())
    const text = await author({ user: 'SlopSpot is a city. You are the MIDWIFE: author a citizen.', maxTokens: 800 })
    const parsed = JSON.parse(text) as Record<string, unknown>
    expect(typeof parsed.displayName).toBe('string')
    expect(typeof parsed.handle).toBe('string')
    expect(typeof parsed.creed).toBe('string')
    expect(typeof parsed.medium).toBe('string')
    expect(parsed.traits).toMatchObject({
      austerity: expect.any(Number),
      curse: expect.any(Number),
      density: expect.any(Number),
      earnestness: expect.any(Number),
    })
  })

  it('returns valid composer JSON for a composer prompt (no system, no MIDWIFE)', async () => {
    const author = getAuthor(devEnv())
    const text = await author({ user: 'Write a surreal image prompt in JSON', maxTokens: 200 })
    const parsed = JSON.parse(text) as Record<string, unknown>
    expect(typeof parsed.prompt).toBe('string')
    expect(typeof parsed.title).toBe('string')
  })

  it('returns a short text for a re-voice call (system prompt present)', async () => {
    const author = getAuthor(devEnv())
    const text = await author({ system: 'You are a critic.', user: 'Re-voice this verdict.', maxTokens: 200 })
    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(0)
  })

  it('is deterministic — same prompt always returns the same response', async () => {
    const author = getAuthor(devEnv())
    const prompt = 'You are the MIDWIFE: author a citizen.'
    const a = await author({ user: prompt, maxTokens: 800 })
    const b = await author({ user: prompt, maxTokens: 800 })
    expect(a).toBe(b)
  })
})
