// [LAW:behavior-not-structure] getAuthor contract: prod always uses the real transport; dev uses
// the deterministic fake whose response is shape-valid for each caller's parser. The selection is
// by env alone — no caller flag, no second function. The fake discriminates by prompt content.

import { describe, expect, it } from 'vitest'
import { AnthropicHttpError, MissingApiKeyError, classifyAnthropicHealth, getAuthor } from '~/lib/haiku'

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

// [LAW:behavior-not-structure] These assert the account-health CONTRACT — which Anthropic
// failure maps to which alert axis — not the internals of how the mapping is computed.
describe('classifyAnthropicHealth', () => {
  it('maps a missing key to down{auth}', () => {
    expect(classifyAnthropicHealth(new MissingApiKeyError())).toEqual({ status: 'down', reason: 'auth' })
  })

  it.each([401, 403])('maps HTTP %i to down{auth}', (status) => {
    expect(classifyAnthropicHealth(new AnthropicHttpError(status, 'unauthorized'))).toEqual({
      status: 'down',
      reason: 'auth',
    })
  })

  it('maps HTTP 402 to down{payment}', () => {
    expect(classifyAnthropicHealth(new AnthropicHttpError(402, 'payment required'))).toEqual({
      status: 'down',
      reason: 'payment',
    })
  })

  it('maps HTTP 429 to down{quota}', () => {
    expect(classifyAnthropicHealth(new AnthropicHttpError(429, 'rate limited'))).toEqual({
      status: 'down',
      reason: 'quota',
    })
  })

  // [LAW:no-silent-failure] The regression guard: Anthropic returns credit exhaustion as a
  // 400 (NOT 402). This body is the verbatim envelope captured live the day the account ran
  // dry; it MUST page as down{payment}, never be swallowed as a self-healing `degraded` blip.
  it('maps a credit-exhaustion 400 to down{payment} (the live billing envelope)', () => {
    const body =
      '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}'
    expect(classifyAnthropicHealth(new AnthropicHttpError(400, body))).toEqual({
      status: 'down',
      reason: 'payment',
    })
  })

  it('matches the credit phrase case-insensitively and inside a reshaped body', () => {
    expect(
      classifyAnthropicHealth(new AnthropicHttpError(400, 'ERROR: Credit Balance Is Too Low — top up')),
    ).toEqual({ status: 'down', reason: 'payment' })
  })

  it('leaves a genuinely-malformed 400 as degraded (does not over-broaden payment)', () => {
    const body =
      '{"type":"error","error":{"type":"invalid_request_error","message":"messages: roles must alternate"}}'
    expect(classifyAnthropicHealth(new AnthropicHttpError(400, body))).toEqual({ status: 'degraded' })
  })

  it('maps a transient 5xx to degraded', () => {
    expect(classifyAnthropicHealth(new AnthropicHttpError(529, 'overloaded'))).toEqual({ status: 'degraded' })
  })

  it('maps a non-HTTP throw (network/timeout) to degraded', () => {
    expect(classifyAnthropicHealth(new Error('network error'))).toEqual({ status: 'degraded' })
  })
})
