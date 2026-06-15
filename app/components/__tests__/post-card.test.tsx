import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { EternalMark, Exchange, PostCard, VerdictLine, Verdicts } from '~/components/post-card'
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

// [LAW:behavior-not-structure] The plate rebalance (the-back-door §The Card): the image is the main
// course, ONE sharp verdict the garnish. So a card renders AT MOST ONE verdict at full weight by default
// — the city's hottest take (verdicts[0]) — and DEMOTES the rest behind a disclosure rather than
// stacking a column. [LAW:no-silent-failure] none are dropped: every demoted critic is still in the
// markup, one click away. These assert the RENDERED dataflow (a value-split + disclosure), not internals.
describe('app/components/post-card.tsx - Verdicts plate (one full-weight, rest demoted)', () => {
  const v = (text: string, critic: string, disposition: Verdict['disposition'] = 'blessed'): Verdict => ({
    text,
    critic,
    disposition,
  })

  it('renders NOTHING when no critic spoke (absence is the data)', () => {
    expect(renderToStaticMarkup(<Verdicts verdicts={[]} />)).toBe('')
  })

  it('a lone verdict is the full-weight line with NO demoted reactions line', () => {
    const html = renderToStaticMarkup(<Verdicts verdicts={[v('The only take.', 'St. Vivian')]} />)
    expect(html).toContain('The only take.')
    // the critic surfaces exactly once (the primary byline) — a demoted reactions texture would
    // surface a critic a second time; there is none here
    expect(html.split('St. Vivian').length - 1).toBe(1)
  })

  it('caps default-visible verdicts to ONE; demotes the rest, keeping the feud glanceable, dropping none', () => {
    const html = renderToStaticMarkup(
      <Verdicts
        verdicts={[v('Primary hottest take.', 'The Populist', 'blessed'), v('A burial.', 'The Mortician', 'buried')]}
      />,
    )
    // [LAW:no-silent-failure] every critic's FULL text still reachable — none silently dropped
    expect(html).toContain('Primary hottest take.')
    expect(html).toContain('A burial.')
    // the feud CO-PRESENCE stays glanceable: the demoted critic is surfaced in a reactions texture
    // BEFORE its full verdict text (which waits behind the disclosure)
    const mortPrimaryMention = html.indexOf('The Mortician')
    const mortFullText = html.indexOf('A burial.')
    expect(mortPrimaryMention).toBeLessThan(mortFullText)
    // both dispositions are legible at a glance — blessed cross AND buried mark co-present on the card
    expect(html).toContain('✚')
    expect(html).toContain('✗')
    // the hottest take leads, at full weight, before the demoted reactions
    expect(html.indexOf('Primary hottest take.')).toBeLessThan(mortPrimaryMention)
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
