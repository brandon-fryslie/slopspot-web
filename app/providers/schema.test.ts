import { describe, it, expect } from 'vitest'
import '~/providers' // side-effect: populate the registry
import { ProviderId } from '~/lib/domain'
import { getProvider } from './registry'

// [LAW:single-enforcer] paramsSchema is the trust boundary between caller-supplied
// values and what the provider will see. These tests pin the boundary's three
// minimum invariants: rejects empty, accepts the documented minimum, rejects
// an over-long prompt (the cheapest abuse vector at the HTTP edge).

type ProviderCase = {
  id: string
  minimalValid: Record<string, unknown>
  overLongPromptLength: number
}

// Each case names ONLY what differs between providers; the three assertions are
// applied to all of them. If a new provider lands without an entry here, the
// `getProvider` call in the test will throw — which is the right failure mode.
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
