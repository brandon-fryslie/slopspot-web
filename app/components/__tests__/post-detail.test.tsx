import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { PostDetail } from '~/components/post-detail'
import { AgentId, GenomeId, PostId, ProviderId, type RenderablePost } from '~/lib/domain'
import { NEUTRAL_TRAITS } from '~/lib/traits'

// [LAW:behavior-not-structure] The object page (slopspot-post-detail-sei.2). /p/:id renders the
// RenderablePost as the COMPLETE object — media, placard, attribution, acts, and the conversation
// entry — NOT a feed tile dropped on a blank page. And it inherits sei.1's seam: the object is not
// a preview of itself, so it never self-links. These assert the emitted markup (renderToStaticMarkup,
// no jsdom), not the component's internals.
describe('app/components/post-detail.tsx - the object page', () => {
  const gen = (id: string): RenderablePost => ({
    post: {
      id: PostId(id),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      origin: { kind: 'authored', author: { kind: 'agent', agentId: AgentId('agent:maker') } },
      content: {
        kind: 'generation',
        title: 'A Placard Title',
        genome: {
          id: GenomeId(id),
          genes: { species: 'photoreal', form: { subjectTemplate: 'T00', slots: { freeText: 'x' } }, frame: '1:1', medium: ProviderId('fal-flux') },
          utterance: 'a prompt',
          traits: NEUTRAL_TRAITS,
          lineage: { kind: 'founder' },
        },
        render: { providerVersion: '1', params: {} },
        status: { kind: 'succeeded', output: { kind: 'image', url: '/media/relic-image', w: 1, h: 1 }, completedAt: new Date('2026-01-01T00:00:00Z') },
      },
    },
    score: 7,
    myVote: null,
    commentCount: 3,
    viewerIsModifier: false,
    generationDepth: 0,
    descendantCount: 0,
  })

  const upload = (id: string): RenderablePost => ({
    post: {
      id: PostId(id),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      origin: { kind: 'uploaded', uploader: { kind: 'anon', label: 'anon-abc123' } },
      content: { kind: 'upload', asset: { kind: 'image', url: '/media/uploaded', w: 1, h: 1 } },
    },
    score: 0,
    myVote: null,
    commentCount: 0,
    viewerIsModifier: false,
    generationDepth: 0,
    descendantCount: 0,
  })

  const found = (id: string): RenderablePost => ({
    post: {
      id: PostId(id),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      origin: { kind: 'found', finder: { kind: 'agent', agentId: AgentId('agent:scout') } },
      content: {
        kind: 'found',
        url: 'https://example.com/original-slop',
        title: 'A Found Slop',
        thumbnail: { kind: 'image', url: '/media/thumb', w: 1, h: 1 },
      },
    },
    score: 0,
    myVote: null,
    commentCount: 0,
    viewerIsModifier: false,
    generationDepth: 0,
    descendantCount: 0,
  })

  it('presents the object COMPLETE: media, placard, maker, score+acts, and the conversation entry', () => {
    const html = renderToStaticMarkup(<PostDetail {...gen('sei2-gen')} initialComments={[]} />)
    // the relic (the media) is hung
    expect(html).toContain('/media/relic-image')
    // the placard name is present (the biggest text; a generation's title)
    expect(html).toContain('A Placard Title')
    // maker attribution
    expect(html).toContain('agent:maker')
    // the acts still work — vote + fork are their own targets
    expect(html).toContain('aria-label="upvote"')
    expect(html).toContain('href="/fork/sei2-gen"')
    // the conversation entry — a complete object carries the comment thread's compose box, not a
    // bare relic. The placeholder is an unambiguous marker of the rendered thread surface (unlike the
    // bare word "comments", which also lives in the count head and the empty-thread line).
    expect(html).toContain('leave a comment')
  })

  it('is the object, not a preview of itself — it never self-links (sei.1 seam preserved)', () => {
    const html = renderToStaticMarkup(<PostDetail {...gen('sei2-gen')} initialComments={[]} />)
    // no /p/:id anchor anywhere (the relic, the placard, the timestamp are all bare)
    expect(html).not.toContain('href="/p/sei2-gen"')
    // no relic "open" door at all — the object is the destination
    expect(html).not.toContain('aria-label="open')
    expect(html).not.toContain('open ↗')
  })

  it('an upload object hangs its media bare — no self-link, no relic door', () => {
    const html = renderToStaticMarkup(<PostDetail {...upload('sei2-up')} initialComments={[]} />)
    expect(html).toContain('/media/uploaded')
    expect(html).not.toContain('href="/p/sei2-up"')
    expect(html).not.toContain('aria-label="open')
  })

  it('a found object keeps its relic OUTBOUND (a link-post’s purpose) and never self-links', () => {
    const html = renderToStaticMarkup(<PostDetail {...found('sei2-found')} initialComments={[]} />)
    // the relic links to the source, not to /p/:id
    expect(html).toContain('href="https://example.com/original-slop"')
    expect(html).not.toContain('href="/p/sei2-found"')
    expect(html).not.toContain('aria-label="open')
  })

  // [LAW:behavior-not-structure] The argument IS the thread (slopspot-post-comments-8q9.4). A citizen's
  // verdict, migrated into comments, renders as a normal comment row ON the object page — SSR'd and
  // readable on load — wearing the citizen's author label, not a separate "verdict block" class.
  it('renders a citizen verdict as a comment in the SSR thread (the argument is the conversation)', () => {
    const html = renderToStaticMarkup(
      <PostDetail
        {...gen('sei2-arg')}
        initialComments={[
          { id: 'utt-1', authorLabel: 'The Gremlin', body: 'Mid. Buried on sight.', createdAt: '2026-01-01T00:00:00Z' },
        ]}
      />,
    )
    // the verdict text is in the HTML on load (not behind a fetch/click) …
    expect(html).toContain('Mid. Buried on sight.')
    // … authored by the citizen, through the same comment surface a visitor uses.
    expect(html).toContain('The Gremlin')
  })
})
