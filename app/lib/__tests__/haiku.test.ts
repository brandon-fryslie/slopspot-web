// [LAW:behavior-not-structure] getAuthor's CONTRACT — the env gate chooses the author, asserted by the
// resolver's CHOICE (a throw vs a shape-valid string), NEVER a live Anthropic call. In prod or an unset
// env the seam is the real transport (callHaiku → MissingApiKeyError when the key is absent, thrown
// before any fetch); only SLOPSPOT_ENV === 'dev' selects the deterministic fake, which is reproducible
// and shape-valid per caller via the discriminator each prompt embeds. This is the keystone that makes
// the LLM-touching ceremonies' SUCCESS path reachable under test (slopspot-ceremony-test-0zy.1).

import { describe, expect, it } from 'vitest'
import { getAuthor, MissingApiKeyError, type HaikuOptions } from '~/lib/haiku'
import { AUTHOR_SHAPE } from '~/lib/author-shape'

const envWith = (over: Partial<Env>): Env =>
  ({ SLOPSPOT_ENV: 'prod', SLOPSPOT_ANTHROPIC_API_KEY: '', ...over }) as unknown as Env

const personaOpts: HaikuOptions = { user: `author a citizen ${AUTHOR_SHAPE.persona}`, maxTokens: 800 }
const composedOpts: HaikuOptions = { user: `compose a slop ${AUTHOR_SHAPE.composed}`, maxTokens: 400 }
const verdictOpts: HaikuOptions = { system: `judge it ${AUTHOR_SHAPE.verdict}`, user: 'a real take', maxTokens: 200 }

describe('getAuthor — the injectable author seam', () => {
  it('selects the REAL transport when SLOPSPOT_ENV is not "dev" (fail-closed): undefined and prod both reach Anthropic', async () => {
    // No key → callHaiku throws before any fetch, so the choice is observable without a live call.
    await expect(getAuthor(envWith({ SLOPSPOT_ENV: undefined }))(personaOpts)).rejects.toBeInstanceOf(MissingApiKeyError)
    await expect(getAuthor(envWith({ SLOPSPOT_ENV: 'prod' }))(personaOpts)).rejects.toBeInstanceOf(MissingApiKeyError)
  })

  it('selects the deterministic FAKE only when SLOPSPOT_ENV === "dev" — shape-valid persona JSON, no key needed', async () => {
    const text = await getAuthor(envWith({ SLOPSPOT_ENV: 'dev' }))(personaOpts)
    const parsed: unknown = JSON.parse(text)
    expect(parsed).toMatchObject({
      handle: expect.any(String),
      displayName: expect.any(String),
      traits: expect.any(Object),
    })
  })

  it('is reproducible — the same prompt yields identical output', async () => {
    const dev = getAuthor(envWith({ SLOPSPOT_ENV: 'dev' }))
    expect(await dev(personaOpts)).toBe(await dev(personaOpts))
  })

  it('returns the shape each caller asks for: composed → {title,prompt} JSON, verdict → a non-JSON line', async () => {
    const dev = getAuthor(envWith({ SLOPSPOT_ENV: 'dev' }))
    const composed: unknown = JSON.parse(await dev(composedOpts))
    expect(composed).toMatchObject({ title: expect.any(String), prompt: expect.any(String) })
    const verdict = await dev(verdictOpts)
    expect(verdict.length).toBeGreaterThan(0)
    expect(() => JSON.parse(verdict)).toThrow()
  })

  it('FAILS LOUD when a prompt carries no shape token — the fake never guesses', async () => {
    await expect(
      getAuthor(envWith({ SLOPSPOT_ENV: 'dev' }))({ user: 'no token here', maxTokens: 100 }),
    ).rejects.toThrow(/exactly one AUTHOR_SHAPE token/)
  })
})
