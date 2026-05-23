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
  overLongPromptLength: number
}

const cases: ProviderCase[] = [
  {
    id: 'fal-flux',
    minimalValid: { prompt: 'hello', aspectRatio: '1:1', steps: 1 },
    overLongPromptLength: 501,
  },
  {
    id: 'fal-flux-mock',
    minimalValid: { prompt: 'hello', aspectRatio: '1:1', steps: 1 },
    overLongPromptLength: 501,
  },
  {
    id: 'replicate-sdxl-mock',
    minimalValid: { prompt: 'hello', width: 512, height: 512, guidanceScale: 7.5 },
    overLongPromptLength: 1001,
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
    const result = provider.paramsSchema.safeParse({
      ...minimalValid,
      prompt: 'x'.repeat(overLongPromptLength),
    })
    expect(result.success).toBe(false)
  })
})
