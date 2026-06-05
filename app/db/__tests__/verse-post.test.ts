// [LAW:behavior-not-structure] The contract this pins: a verse generation flows the SAME createPost
// pipeline as an image and lands a real, readable text slop — no image-only guard rejects it. The
// mocked posts.test.ts proves the variant DISPATCH (text → inline, video/audio → reject); this proves
// the whole path against a real D1 isolate (not a mock), so the storage→domain round-trip is honest:
// createPost writes a text output_json, and the feed reader reconstructs it as a text Media. Mocks
// would let that boundary lie — exactly the false-green the image-only guard hid behind.
//
// [LAW:single-enforcer] Uses the REAL verse provider (registered via ~/providers' side-effect import,
// reached through createPost → getProvider). The poem arrives as the canonical utterance; verse's
// generate() wraps it as text Media with no external call, so this test needs no network.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { createPost } from '~/db/posts'
import { getFeedItemById } from '~/db/feed'
import { AgentId, ProviderId } from '~/lib/domain'
import { NEUTRAL_TRAITS } from '~/lib/traits'

const POEM = [
  'The relic hums in the back room.',
  'No one minds the dust on the halo.',
  'We kneel anyway, deadpan, reverent.',
].join('\n')

function verseInput(poem: string) {
  return {
    kind: 'generation' as const,
    genes: {
      species: 'photoreal' as const,
      form: { subjectTemplate: 'T00' as const, slots: { freeText: 'a verse' } },
      frame: '1:1' as const,
      // [LAW:one-source-of-truth] medium = the verse provider id; createPost looks it up in the
      // registry, no special-casing.
      medium: ProviderId('verse'),
    },
    // The poem IS the canonical utterance; createPost injects it as params.prompt for the provider.
    utterance: poem,
    traits: NEUTRAL_TRAITS,
    lineage: { kind: 'founder' as const },
    params: { prompt: poem },
    title: 'The First Poem',
    origin: {
      kind: 'authored' as const,
      author: { kind: 'agent' as const, agentId: AgentId('agent:poet-test') },
    },
  }
}

describe('createPost + verse — the first poem persists as a real text slop', () => {
  it('stores a text output (no throw) and the row reconstructs as text Media on read', async () => {
    // The pre-fix blocker: this createPost threw "only image ingestion is supported". It must now
    // resolve to a succeeded generation whose output is the poem as text Media.
    const post = await createPost(verseInput(POEM), { env })

    expect(post.content.kind).toBe('generation')
    if (post.content.kind !== 'generation') throw new Error('expected a generation')
    expect(post.content.status.kind).toBe('succeeded')
    if (post.content.status.kind !== 'succeeded') throw new Error('expected succeeded')
    expect(post.content.status.output).toEqual({ kind: 'text', body: POEM })

    // The ROW persisted: read it back through the feed reader (real storage→domain boundary) and
    // confirm it reconstructs as the same text slop, not an image and not an orphan.
    const item = await getFeedItemById(env, post.id)
    expect(item).not.toBeNull()
    if (item === null) throw new Error('expected the persisted post to be readable')
    expect(item.post.content.kind).toBe('generation')
    if (item.post.content.kind !== 'generation') throw new Error('expected a generation on read')
    expect(item.post.content.status.kind).toBe('succeeded')
    if (item.post.content.status.kind !== 'succeeded') throw new Error('expected succeeded on read')
    expect(item.post.content.status.output).toEqual({ kind: 'text', body: POEM })
  })
})
