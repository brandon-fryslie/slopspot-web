import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { EternalMark, Exchange, PostCard, VerdictLine } from '~/components/post-card'
import { AgentId, GenomeId, PostId, ProviderId, type Crowning, type Lineage, type RenderablePost, type Verdict } from '~/lib/domain'
import { NEUTRAL_TRAITS } from '~/lib/traits'

// [LAW:behavior-not-structure] Pin the RENDERED ROBE for both dispositions: the
// disposition value alone must select the glyph + color, so a BLESSING wears the
// gilt cross and a BURIAL the profane magenta — the same votive/profane duality the
// votes carry. renderToStaticMarkup keeps this DOM-free (no jsdom) while asserting the
// actual emitted markup, not the component's internals.
describe('app/components/post-card.tsx - VerdictLine robe', () => {
  const verdict = (disposition: Verdict['disposition']): Verdict => ({
    text: 'A line with an opinion in it.',
    critic: 'St. Vivian',
    disposition,
  })

  it('dresses a blessing in the gilt cross', () => {
    const html = renderToStaticMarkup(<VerdictLine verdict={verdict('blessed')} />)
    expect(html).toContain('✚')
    expect(html).toContain('text-gilt')
    expect(html).toContain('border-gilt/40')
    expect(html).not.toContain('text-profane')
  })

  it('dresses a burial in the profane glyph — never the saint robes', () => {
    const html = renderToStaticMarkup(<VerdictLine verdict={verdict('buried')} />)
    expect(html).toContain('✗')
    expect(html).toContain('text-profane')
    expect(html).toContain('border-profane/50')
    expect(html).not.toContain('✚')
    expect(html).not.toContain('text-gilt')
  })
})

// [LAW:behavior-not-structure] The Feud Engine's back-and-forth (voice-w2v.2) renders by the exchange
// ARRAY's LENGTH — the discriminator, never an isFeud flag: empty → no thread at all, ≥1 → the answers
// the citizens traded, each a Verdict-shaped line reusing the verdict robe. Asserts the rendered
// dataflow, not the component internals.
describe('app/components/post-card.tsx - Exchange thread', () => {
  const reply = (text: string, disposition: Verdict['disposition']): Verdict => ({
    text,
    critic: 'The Gremlin',
    disposition,
  })

  it('renders NOTHING for an empty exchange (no opposing verdicts → no thread)', () => {
    expect(renderToStaticMarkup(<Exchange exchange={[]} />)).toBe('')
  })

  it('renders the traded answers when the exchange is non-empty', () => {
    const html = renderToStaticMarkup(
      <Exchange
        exchange={[reply('St. Vivian again. Of course.', 'buried'), reply('The Gremlin buries everything.', 'blessed')]}
      />,
    )
    expect(html).toContain('St. Vivian again. Of course.')
    expect(html).toContain('The Gremlin buries everything.')
    expect(html).toContain('the exchange')
    // each answer wears its speaker's disposition robe — the gilt-vs-profane argument is legible
    expect(html).toContain('text-profane')
    expect(html).toContain('text-gilt')
  })
})

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
        status: { kind: 'succeeded', output: { kind: 'image', url: '/media/x', w: 1, h: 1 } },
      },
    },
    score: 0,
    myVote: null,
    commentCount: 0,
    viewerIsModifier: false,
    verdicts: [],
    exchange: [],
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
