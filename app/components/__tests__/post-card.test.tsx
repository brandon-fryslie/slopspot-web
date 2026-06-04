import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { EternalMark, VerdictLine } from '~/components/post-card'
import type { Crowning, Verdict } from '~/lib/domain'

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
