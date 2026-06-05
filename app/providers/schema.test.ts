import { describe, it, expect } from 'vitest'
import { getProvider, listProviders } from '~/providers'
import { ProviderId } from '~/lib/domain'

// [LAW:single-enforcer] paramsSchema is the trust boundary between caller-supplied
// values and what the provider will see. These tests pin the boundary's three
// minimum invariants: rejects empty, accepts the documented minimum, rejects
// an over-long prompt (the cheapest abuse vector at the HTTP edge).
//
// Importing via ~/providers (not ~/providers/registry) keeps tests on the public
// surface — the side-effect entrypoint owns "what providers exist". The
// coverage-gap assertion below makes that ownership load-bearing: a new provider
// added to ~/providers/index.ts that isn't listed here fails this file.

type ProviderCase = {
  id: string
  minimalValid: Record<string, unknown>
  // undefined = no max-length constraint (e.g. verse); the over-long test is
  // skipped for these providers since there is nothing to assert.
  overLongPromptLength?: number
}

// [LAW:single-enforcer] Post-pl6.2 paramsSchemas no longer carry aspectRatio
// (canonical AspectRatio is a Generation top-level field, not provider input).
// SDXL likewise no longer takes width/height in params — those derive from
// the canonical AspectRatio via the provider's own translation table.
const cases: ProviderCase[] = [
  {
    id: 'fal-flux',
    minimalValid: { prompt: 'hello', steps: 1 },
    overLongPromptLength: 501,
  },
  {
    id: 'fal-flux-mock',
    minimalValid: { prompt: 'hello', steps: 1 },
    overLongPromptLength: 501,
  },
  {
    id: 'replicate-sdxl',
    minimalValid: { prompt: 'hello', guidanceScale: 7.5 },
    overLongPromptLength: 1001,
  },
  {
    id: 'replicate-sdxl-mock',
    minimalValid: { prompt: 'hello', guidanceScale: 7.5 },
    overLongPromptLength: 1001,
  },
  {
    id: 'replicate-ideogram',
    minimalValid: { prompt: 'hello' },
    overLongPromptLength: 1001,
  },
  {
    id: 'replicate-ideogram-mock',
    minimalValid: { prompt: 'hello' },
    overLongPromptLength: 1001,
  },
  {
    // Verse has no provider-side max length — the poem body is unconstrained.
    id: 'verse',
    minimalValid: { prompt: 'a short poem' },
    // overLongPromptLength intentionally absent
  },
]

// [LAW:types-are-the-program] Make the coverage gap impossible. listProviders()
// is the public surface's enumeration; comparing the registered set to `cases`
// means adding a new provider without extending this file is a test failure,
// not a silent skip. The comparison is set-equality (sorted), so order in
// either list doesn't matter.
describe('schema test coverage', () => {
  it('lists every registered provider', () => {
    const registered = listProviders().map((p) => p.id as string).sort()
    const covered = cases.map((c) => c.id).sort()
    expect(covered).toEqual(registered)
  })
})

describe.each(cases)('$id paramsSchema', ({ id, minimalValid, overLongPromptLength }) => {
  const provider = getProvider(ProviderId(id))

  it('rejects an empty object', () => {
    expect(provider.paramsSchema.safeParse({}).success).toBe(false)
  })

  it('accepts the documented minimal valid input', () => {
    const result = provider.paramsSchema.safeParse(minimalValid)
    expect(result.success).toBe(true)
  })

  it('rejects an over-long prompt at the trust boundary', () => {
    // Verse has no max-length constraint — skip this assertion for it.
    if (overLongPromptLength === undefined) return
    const result = provider.paramsSchema.safeParse({
      ...minimalValid,
      prompt: 'x'.repeat(overLongPromptLength),
    })
    expect(result.success).toBe(false)
  })
})
