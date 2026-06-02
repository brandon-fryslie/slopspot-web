// [LAW:behavior-not-structure] The contract of the one parse of config.portrait:
// which of the four states a given config datum resolves to. The card, the Cast,
// and the drift scheduler all depend on this mapping being exactly these cases.

import { describe, expect, it } from 'vitest'
import { portraitStateOf } from '~/lib/portrait'

describe('portraitStateOf — the config.portrait parse', () => {
  it('resolves the Proprietor — the "declined" string is a first-class state', () => {
    expect(portraitStateOf({ portrait: 'declined' })).toEqual({ kind: 'declined' })
  })

  it('resolves the Gremlin — the "refused" string is a first-class state', () => {
    expect(portraitStateOf({ portrait: 'refused' })).toEqual({ kind: 'refused' })
  })

  it('resolves a rendered self-portrait, carrying url + renderedAt', () => {
    expect(portraitStateOf({ portrait: { url: '/media/abc', renderedAt: 1000 } })).toEqual({
      kind: 'rendered',
      url: '/media/abc',
      renderedAt: 1000,
    })
  })

  it('is unrendered when the key is absent — a citizen with no face yet', () => {
    expect(portraitStateOf({})).toEqual({ kind: 'unrendered' })
    expect(portraitStateOf({ medium: 'fal-flux' })).toEqual({ kind: 'unrendered' })
  })

  it('rejects a non-local url — a rendered portrait is only ever a /media/ path', () => {
    // A hostile config_json write must not make the frame's <img src> fetch a
    // third-party URL; only ingestImage's same-origin output is a real portrait.
    expect(portraitStateOf({ portrait: { url: 'https://evil.example/x.png', renderedAt: 1 } })).toEqual({
      kind: 'unrendered',
    })
    expect(portraitStateOf({ portrait: { url: '//evil.example/x.png', renderedAt: 1 } })).toEqual({
      kind: 'unrendered',
    })
  })

  it('degrades a half-written portrait to unrendered, never a fresh-looking rendered', () => {
    // A url with no renderedAt would be a face the drift scheduler then never
    // revisits — so the rendered arm demands BOTH. A bad shape is a placeholder,
    // never a throw (a malformed portrait must not 500 the roster).
    expect(portraitStateOf({ portrait: { url: '/media/abc' } })).toEqual({ kind: 'unrendered' })
    expect(portraitStateOf({ portrait: { renderedAt: 1000 } })).toEqual({ kind: 'unrendered' })
    expect(portraitStateOf({ portrait: { url: '', renderedAt: 1000 } })).toEqual({ kind: 'unrendered' })
    expect(portraitStateOf({ portrait: 'pending' })).toEqual({ kind: 'unrendered' })
    expect(portraitStateOf({ portrait: 42 })).toEqual({ kind: 'unrendered' })
  })
})
