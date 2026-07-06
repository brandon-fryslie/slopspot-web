import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { CommentSection, EternalMark, PostCard } from '~/components/post-card'
import { AgentId, GenomeId, PostId, ProviderId, type Crowning, type Lineage, type RenderablePost } from '~/lib/domain'
import { NEUTRAL_TRAITS } from '~/lib/traits'

// [LAW:behavior-not-structure] The eternal mark must read as a canonization SEAL, not a
// metadata tag: the sacred word wears the cathedral serif (font-placard) and weight, the
// ✚ is struck as a ringed seal, the feast-day date survives, and the tone is the mark
// (gilt for a Saint). These assert the RENDERED contract CD's refinement set, not the
// component's internals.
describe('app/components/post-card.tsx - EternalMark seal', () => {
  const crowning = (mark: Crowning['mark'], lens: Crowning['lens']): Crowning => ({
    lens,
    mark,
    riteDay: '2026-06-01',
    presiding: { handle: 'st-vivian', displayName: 'St. Vivian' },
  })

  it('strikes a saint as a gilt seal in the cathedral serif, date kept', () => {
    const html = renderToStaticMarkup(<EternalMark crowning={crowning('gold', 'saint')} />)
    // the sacred word in the sacred typeface, with weight — not the machine mono
    expect(html).toContain('font-placard')
    expect(html).toContain('font-bold')
    expect(html).toContain('Sainted')
    // the ✚ struck as a ringed seal medallion, not an inline glyph
    expect(html).toContain('✚')
    expect(html).toContain('rounded-full')
    // gilt tone — gold is the Saint's
    expect(html).toContain('text-gilt')
    // the feast-day date grounds it in the liturgical calendar
    expect(html).toContain('2026-06-01')
  })

  it('tones a villain profane, never gilt — the mark scarcity holds', () => {
    const html = renderToStaticMarkup(<EternalMark crowning={crowning('magenta', 'villain')} />)
    expect(html).toContain('text-profane')
    expect(html).not.toContain('text-gilt')
    expect(html).toContain('Villain')
  })
})

// [LAW:dataflow-not-control-flow] The card surfaces a generation's lineage scalars (genome-p6z.3) BY
// THE NUMBER the read boundary derived: "gen N" when generationDepth > 0, "N bred" when
// descendantCount > 0. A founder is gen 0 / 0 bred and shows NEITHER (the absence is the data, never an
// isRoot flag). These pin the gating so a regression to "always show" or "isRoot branch" fails.
describe('app/components/post-card.tsx - lineage scalars (gen N / N bred)', () => {
  const renderable = (opts: {
    lineage: Lineage
    generationDepth: number
    descendantCount: number
  }): RenderablePost => ({
    post: {
      id: PostId('lc-render'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      origin: { kind: 'authored', author: { kind: 'agent', agentId: AgentId('agent:maker') } },
      content: {
        kind: 'generation',
        title: 'A Placard',
        genome: {
          id: GenomeId('lc-render'),
          genes: {
            species: 'photoreal',
            form: { subjectTemplate: 'T00', slots: { freeText: 'x' } },
            frame: '1:1',
            medium: ProviderId('fal-flux'),
          },
          utterance: 'a prompt',
          traits: NEUTRAL_TRAITS,
          lineage: opts.lineage,
        },
        render: { providerVersion: '1', params: {} },
        status: { kind: 'succeeded', output: { kind: 'image', url: '/media/x', w: 1, h: 1 }, completedAt: new Date('2026-01-01T00:00:00Z') },
      },
    },
    score: 0,
    myVote: null,
    commentCount: 0,
    viewerIsModifier: false,
    generationDepth: opts.generationDepth,
    descendantCount: opts.descendantCount,
  })

  const draw = (rp: RenderablePost) => renderToStaticMarkup(<PostCard {...rp} frame={{ kind: 'standalone' }} />)

  it('a gen-2 child shows "gen 2"', () => {
    const html = draw(renderable({ lineage: { kind: 'single', parent: GenomeId('p') }, generationDepth: 2, descendantCount: 0 }))
    expect(html).toContain('gen 2')
    expect(html).not.toMatch(/\d+ bred/) // no breed-count: this leaf bred nothing
  })

  it('a most-bred parent shows the descendant count ("3 bred")', () => {
    const html = draw(renderable({ lineage: { kind: 'founder' }, generationDepth: 0, descendantCount: 3 }))
    expect(html).toContain('3 bred')
    expect(html).not.toMatch(/gen \d+/) // a founder is gen 0 — no depth badge
  })

  it('a founder with no descendants shows NEITHER badge (absence by data)', () => {
    const html = draw(renderable({ lineage: { kind: 'founder' }, generationDepth: 0, descendantCount: 0 }))
    expect(html).not.toMatch(/gen \d+/)
    expect(html).not.toMatch(/\d+ bred/)
  })
})

// [LAW:behavior-not-structure] The feed→object click target (slopspot-post-detail-sei.1). A
// card hung as a PREVIEW (any frame but standalone) opens its /p/:id object through obvious,
// keyboard-reachable doors; the STANDALONE permalink — the object itself — links to nothing.
// The affordance is DERIVED from the frame viewpoint, so these pin the emitted href, not internals.
describe('app/components/post-card.tsx - post-detail click target', () => {
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
    score: 0,
    myVote: null,
    commentCount: 0,
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

  it('a PREVIEW generation card opens its /p/:id object (relic + placard), keyboard-reachable', () => {
    const html = renderToStaticMarkup(<PostCard {...gen('sei-gen')} frame={{ kind: 'study' }} />)
    // Both textual/visual doors point at the object; the relic link carries an accessible name
    // that NAMES the slop (its title, not a shared fixed string) and a visible cue so pointer
    // AND keyboard users can find it.
    expect(html).toContain('href="/p/sei-gen"')
    expect(html).toContain('aria-label="open “A Placard Title”"')
    expect(html).toContain('open ↗')
  })

  it('the STANDALONE permalink card never links to itself — the object is not a preview', () => {
    const html = renderToStaticMarkup(<PostCard {...gen('sei-gen')} frame={{ kind: 'standalone' }} />)
    expect(html).not.toContain('href="/p/sei-gen"')
    expect(html).not.toContain('aria-label="open') // no relic door at all on the object itself
    // The placard still renders — only its LINK is gone, the title text is unchanged.
    expect(html).toContain('A Placard Title')
  })

  it('the detail door does not steal the card’s own controls — vote and fork still act', () => {
    const html = renderToStaticMarkup(<PostCard {...gen('sei-gen')} frame={{ kind: 'study' }} />)
    // Existing controls remain their own separate targets (not swallowed by the detail link).
    expect(html).toContain('aria-label="upvote"')
    expect(html).toContain('href="/fork/sei-gen"')
  })

  it('a found preview keeps its relic OUTBOUND; its detail door is the permalink timestamp', () => {
    const html = renderToStaticMarkup(<PostCard {...found('sei-found')} frame={{ kind: 'study' }} />)
    // The relic (thumbnail + title) links to the source — a link-post's whole purpose — NOT to /p/:id.
    expect(html).toContain('href="https://example.com/original-slop"')
    // The object is still reachable: the timestamp is the found card's detail door.
    expect(html).toContain('href="/p/sei-found"')
    // Found's relic is NOT re-wrapped in the object anchor.
    expect(html).not.toContain('aria-label="open')
  })

  it('an upload preview opens /p/:id through its relic; the standalone upload renders bare', () => {
    // Upload flows through the SAME RelicView as generation (its only detail door — an upload
    // has no placard title). A preview links; the object itself does not self-link.
    const preview = renderToStaticMarkup(<PostCard {...upload('sei-up')} frame={{ kind: 'study' }} />)
    expect(preview).toContain('href="/p/sei-up"')
    expect(preview).toContain('aria-label="open this slop"')
    const object = renderToStaticMarkup(<PostCard {...upload('sei-up')} frame={{ kind: 'standalone' }} />)
    expect(object).not.toContain('href="/p/sei-up"')
    expect(object).not.toContain('aria-label="open')
  })

  it('an upload with alt text names its relic link by that alt (its only truthful distinguisher)', () => {
    const u = upload('sei-up2')
    if (u.post.content.kind !== 'upload') throw new Error('fixture is an upload')
    u.post.content.asset = { kind: 'image', url: '/media/uploaded', w: 1, h: 1, alt: 'a hand-drawn cat' }
    const html = renderToStaticMarkup(<PostCard {...u} frame={{ kind: 'study' }} />)
    expect(html).toContain('aria-label="open “a hand-drawn cat”"')
  })

  // [LAW:behavior-not-structure] The argument is OFF the tile (slopspot-post-comments-8q9.5/.6). The
  // conversation lives in the thread on the object page; the RenderablePost no longer even carries a
  // verdict/exchange array (8q9.6). The tile shows a compact preview — the comment count and a door to
  // the object page — never the multi-line argument it used to embed.
  it('renders a comment preview + door to the object page, not the argument itself', () => {
    const rp = gen('sei-arg')
    const withArg: RenderablePost = { ...rp, commentCount: 4 }
    const html = renderToStaticMarkup(<PostCard {...withArg} frame={{ kind: 'study' }} />)
    // the argument is previewed (the count) with a door to the object page where the thread lives.
    expect(html).toContain('4 comments')
    expect(html).toContain('href="/p/sei-arg"')
  })

  it('an in-progress generation relic keeps its STATUS in the link name (not just “open”)', () => {
    // The relic label must not hide the slop's state behind a fixed string: a still-generating
    // frame is a door, but its accessible name says so — the reviewer's a11y point made concrete.
    const g = gen('sei-run')
    if (g.post.content.kind !== 'generation') throw new Error('fixture is a generation')
    g.post.content.status = { kind: 'running', startedAt: new Date('2026-01-01T00:00:00Z') }
    const html = renderToStaticMarkup(<PostCard {...g} frame={{ kind: 'study' }} />)
    expect(html).toContain('aria-label="open “A Placard Title” — generating"')
  })
})

// [LAW:one-source-of-truth] When the thread is SSR'd, the header count IS the rendered rows, never the
// separate `commentCount` aggregate (which can race the row read in D1's WAL). A stale aggregate must
// not win over the rows actually on the page.
describe('app/components/post-card.tsx - CommentSection SSR count', () => {
  it('derives the header count from the SSR rows, not a stale initialCount aggregate', () => {
    const html = renderToStaticMarkup(
      <CommentSection
        postId="p1"
        initialCount={99}
        initialComments={[
          { id: 'utt-1', authorLabel: 'The Gremlin', body: 'One.', createdAt: '2026-01-01T00:00:00Z' },
          { id: 'utt-2', authorLabel: 'St. Vivian', body: 'Two.', createdAt: '2026-01-01T00:00:01Z' },
        ]}
      />,
    )
    expect(html).toContain('2 comments')
    expect(html).not.toContain('99 comments')
    // the argument is in the HTML on load — expanded, both lines rendered
    expect(html).toContain('One.')
    expect(html).toContain('Two.')
  })
})
