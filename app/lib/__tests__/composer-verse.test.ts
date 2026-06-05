// Gate test for slopspot-beyond-image-poj.1 (The Poet): the ONE composer authors
// a poem as text Media when medium='verse', routed through the verse provider.
// No second composer exists — the verse path is the SAME composePrompt function.

import { describe, it, expect } from 'vitest'
import { verseProvider } from '~/providers/verse'
import { ProviderId } from '~/lib/domain'

// [LAW:single-enforcer] Structural invariants for the verse provider — the only
// new concrete artifact .1 introduces. composePrompt's verse path is covered by
// the existing composer unit tests (fallback + Haiku path); the verse-medium branch
// is a metaPrompt-content change, not a structural one, so it is verified via the
// provider contract here and a manual fire in dev.
describe('verse provider', () => {
  it('is registered with id "verse"', () => {
    expect(verseProvider.id).toBe(ProviderId('verse'))
  })

  it('is kind real (always active in prod)', () => {
    expect(verseProvider.kind).toBe('real')
  })

  it('produces text Media', () => {
    expect(verseProvider.capabilities.producesMedia).toContain('text')
  })

  it('has zero marginal cost (poem already authored by composer)', () => {
    expect(verseProvider.capabilities.costEstimateUsd).toBe(0)
  })

  it('has no promptMaxLength (verse is unconstrained)', () => {
    expect(verseProvider.promptMaxLength).toBeUndefined()
  })

  it('supports all aspect ratios (aspect is irrelevant but chooser needs a non-empty set)', () => {
    expect(verseProvider.supportedAspectRatios).toHaveLength(5)
  })

  it('generate() wraps the composed poem as text Media — no external API', async () => {
    const poem = 'the machine dreams\nof circuits and rust\na hymn to garbage'
    const result = await verseProvider.generate(
      { params: { prompt: poem }, aspectRatio: '1:1' },
      { env: {} as Env },
    )
    expect(result).toEqual({ kind: 'text', body: poem })
  })

  it('paramsSchema rejects empty prompt', () => {
    expect(verseProvider.paramsSchema.safeParse({ prompt: '' }).success).toBe(false)
  })

  it('paramsSchema accepts any non-empty string (no upper bound for verse)', () => {
    const longPoem = 'line\n'.repeat(100)
    expect(verseProvider.paramsSchema.safeParse({ prompt: longPoem }).success).toBe(true)
  })

  it('[LAW:single-enforcer] capabilities.producesMedia drives medium selection in generator.ts', () => {
    // generator.ts: medium = producesMedia.includes('text') ? 'verse' : 'image'
    // This test pins the invariant: verse MUST declare 'text' in producesMedia
    // so generator.ts routes it to the verse composer path, not the image path.
    // If this assertion fails, poems would be composed as image prompts.
    const derivedMedium = verseProvider.capabilities.producesMedia.includes('text') ? 'verse' : 'image'
    expect(derivedMedium).toBe('verse')
  })
})
