import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { VerdictLine } from '~/components/post-card'
import type { Verdict } from '~/lib/domain'

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
