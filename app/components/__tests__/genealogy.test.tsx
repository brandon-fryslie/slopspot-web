import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { StaticRouter } from 'react-router'
import { GenealogyView } from '~/components/genealogy'
import { PostId, type Genealogy, type GenealogyNode } from '~/lib/domain'

// [LAW:behavior-not-structure] The lineage tree's legibility contract (slopspot-post-detail-sei.3):
// a node reads in its piece's NAME — the identity a visitor understands — with the serial demoted to
// the machine register beneath it, and a nameless legacy node stands on its serial alone (no
// fabricated name). Asserts the emitted markup, not the component's internals.

// GenealogyView renders <Link>s, so it needs a router context — StaticRouter supplies one (DOM-free).
function render(genealogy: Genealogy): string {
  return renderToStaticMarkup(
    <StaticRouter location="/">
      <GenealogyView genealogy={genealogy} />
    </StaticRouter>,
  )
}

const named: GenealogyNode = {
  postId: PostId('aaaa1111-2222-3333-4444-555566667777'),
  title: 'Wolf at the Threshold',
  thumbnail: { kind: 'image', url: '/media/wolf', w: 8, h: 8 },
  kin: [],
}
const nameless: GenealogyNode = {
  postId: PostId('bbbb8888-9999-0000-1111-222233334444'),
  title: null,
  thumbnail: null,
  kin: [],
}

describe('app/components/genealogy.tsx - the lineage tree reads in names', () => {
  it('surfaces a node’s placard name and demotes its serial', () => {
    const html = render({ ancestors: [named], offspring: [], siblings: [] })
    // the legible name a visitor understands without inspecting ids
    expect(html).toContain('Wolf at the Threshold')
    // the serial is still present (the machine register), and the node links to its permalink
    expect(html).toContain('p:aaaa1111')
    expect(html).toContain('href="/p/aaaa1111-2222-3333-4444-555566667777"')
  })

  it('a nameless legacy node stands on its serial alone — no fabricated name', () => {
    const html = render({ ancestors: [], offspring: [nameless], siblings: [] })
    // its serial is the identity shown
    expect(html).toContain('p:bbbb8888')
    // and nothing invents a name for it (no "null", no empty placard leaking through)
    expect(html).not.toContain('>null<')
  })
})
