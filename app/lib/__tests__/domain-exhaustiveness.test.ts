import { describe, it, expect } from 'vitest'
import { ProviderId, type Content, type GenerationStatus, type Media } from '~/lib/domain'

// [LAW:types-are-the-program] This test's runtime body is trivial — its real
// job is to fail `tsc -b` when a new variant is added to Content,
// GenerationStatus, or Media without being handled. The `: never` assignments
// below are exhaustiveness gates; adding a new `kind` upstream without
// extending these switches makes the default branch reachable with a non-never
// value, which the compiler refuses. So this file is a behavioral test only in
// the sense that "the type system rejects unhandled variants" is the behavior;
// the verifier is `pnpm typecheck`, not vitest's runner.

function contentDiscriminator(c: Content): string {
  switch (c.kind) {
    case 'generation':
      return 'generation'
    case 'upload':
      return 'upload'
    default: {
      const _exhaustive: never = c
      return _exhaustive
    }
  }
}

function generationStatusDiscriminator(s: GenerationStatus): string {
  switch (s.kind) {
    case 'pending':
      return 'pending'
    case 'running':
      return 'running'
    case 'succeeded':
      return 'succeeded'
    case 'failed':
      return 'failed'
    default: {
      const _exhaustive: never = s
      return _exhaustive
    }
  }
}

function mediaDiscriminator(m: Media): string {
  switch (m.kind) {
    case 'image':
      return 'image'
    case 'video':
      return 'video'
    case 'text':
      return 'text'
    case 'audio':
      return 'audio'
    default: {
      const _exhaustive: never = m
      return _exhaustive
    }
  }
}

describe('domain exhaustiveness (compile-time)', () => {
  it('Content has exactly the variants the discriminator handles', () => {
    const generation: Content = {
      kind: 'generation',
      recipe: {
        providerId: ProviderId('p'),
        providerVersion: 'v',
        params: {},
        styleFamily: 'photoreal',
        aspectRatio: '1:1',
        subject: { subjectTemplate: 'T00', slots: { freeText: 'x' } },
      },
      status: { kind: 'pending', queuedAt: new Date() },
    }
    const upload: Content = {
      kind: 'upload',
      asset: { kind: 'text', body: 'x' },
    }
    expect(contentDiscriminator(generation)).toBe('generation')
    expect(contentDiscriminator(upload)).toBe('upload')
  })

  it('GenerationStatus has exactly four variants', () => {
    const cases: GenerationStatus[] = [
      { kind: 'pending', queuedAt: new Date() },
      { kind: 'running', startedAt: new Date() },
      { kind: 'succeeded', output: { kind: 'text', body: 'x' }, completedAt: new Date() },
      { kind: 'failed', reason: 'boom', failedAt: new Date() },
    ]
    expect(cases.map(generationStatusDiscriminator)).toEqual([
      'pending',
      'running',
      'succeeded',
      'failed',
    ])
  })

  it('Media has exactly four variants', () => {
    const cases: Media[] = [
      { kind: 'image', url: 'u', w: 1, h: 1 },
      { kind: 'video', url: 'u', durationMs: 1 },
      { kind: 'text', body: 'x' },
      { kind: 'audio', url: 'u', durationMs: 1 },
    ]
    expect(cases.map(mediaDiscriminator)).toEqual(['image', 'video', 'text', 'audio'])
  })
})
