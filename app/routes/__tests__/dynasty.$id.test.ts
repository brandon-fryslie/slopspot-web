// [LAW:behavior-not-structure] The /dynasty/:id loader gate (slopspot-genome-p6z.2): only a real
// GENERATION has a genome and thus a bloodline, so a missing id OR a non-generation post (upload/found)
// is a 404 — never a blank page or a downstream corruption throw. A real generation yields its founder
// forest. Pins the loader's 404 gate against a real D1 isolate.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { loader } from '~/routes/dynasty.$id'
import { seedPost } from '~/db/__tests__/helpers'

const args = (id: string) =>
  ({ params: { id }, context: { cloudflare: { env } } }) as unknown as Parameters<typeof loader>[0]

// The thrown value on the 404 path is a Response (RR7 loaders throw Responses for non-200).
async function caught(id: string): Promise<unknown> {
  return loader(args(id)).then(
    () => null,
    (e) => e,
  )
}

describe('/dynasty/:id loader - 404 gate (genome-p6z.2)', () => {
  it('404s a missing post (no genome, no dynasty)', async () => {
    const err = await caught('dyn-route-missing')
    expect(err).toBeInstanceOf(Response)
    expect((err as Response).status).toBe(404)
  })

  it('404s a non-generation post (a found link has no bloodline)', async () => {
    const found = await seedPost(env, { id: 'dyn-route-found', content: { kind: 'found' } })
    const err = await caught(found)
    expect(err).toBeInstanceOf(Response)
    expect((err as Response).status).toBe(404)
  })

  it('renders the dynasty for a real generation root', async () => {
    const gen = await seedPost(env, { id: 'dyn-route-gen', content: { kind: 'generation' } })
    const data = await loader(args(gen))
    // A lone generation is its own one-founder dynasty — the loader returns it, no throw.
    expect(data.dynasty.founders.map((n) => n.postId)).toEqual([gen])
  })
})
