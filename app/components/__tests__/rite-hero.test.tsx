import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router'
import { describe, it, expect } from 'vitest'
import { RiteHero, bannerExcludeId, type Contender, type RitePhase } from '~/components/rite-hero'
import { PostId, type Media } from '~/lib/domain'

// [LAW:behavior-not-structure] Pin what the banner RENDERS per phase — the phase value
// alone selects the face — without asserting the component's internals. renderToStaticMarkup
// keeps this DOM-free (no jsdom); StaticRouter supplies the Link context the contenders use.
const render = (phase: RitePhase) =>
  renderToStaticMarkup(
    <StaticRouter location="/">
      <RiteHero phase={phase} />
    </StaticRouter>,
  )

const contender = (id: string, url: string): Contender => ({
  postId: id,
  media: { kind: 'image', url, w: 512, h: 512, alt: 'a contender' } as Extract<Media, { kind: 'image' }>,
})

describe('RiteHero — the empty altar renders nothing', () => {
  it('emits no markup when no crown has ever settled', () => {
    expect(render({ phase: 'empty' })).toBe('')
  })
})

describe('RiteHero — the 2–3am Deliberation (the held breath)', () => {
  const phase: RitePhase = {
    phase: 'deliberation',
    contenders: [contender('post:aaa', '/media/aaa'), contender('post:bbb', '/media/bbb')],
  }

  it('shows the held-breath copy — no verdict, only the considering', () => {
    const html = render(phase)
    expect(html).toContain('The back door is deciding. Come back at three.')
    expect(html).toContain('rite-deliberate')
  })

  it('hangs each contender as a verdict-less teaser linking to its permalink', () => {
    const html = render(phase)
    expect(html).toContain('href="/p/post:aaa"')
    expect(html).toContain('href="/p/post:bbb"')
    expect(html).toContain('/media/aaa')
    expect(html).toContain('/media/bbb')
    // [LAW:no-silent-fallbacks] the verdict is WITHHELD — the gilt crown frame/seal that
    // canonizes a saint must NOT appear during deliberation (no verdict has been reached).
    expect(html).not.toContain('crown-settle')
    expect(html).not.toContain('presided by')
  })

  it('renders the held breath even when the city was quiet — no contenders, still the copy', () => {
    const html = render({ phase: 'deliberation', contenders: [] })
    expect(html).toContain('The back door is deciding. Come back at three.')
    expect(html).not.toContain('href="/p/')
  })
})

describe('bannerExcludeId — only the gilt relic is kept off the wall', () => {
  it('excludes the settled crown so it is never also a tile', () => {
    // a settled hero only needs its post id for this contract; the full card render is
    // covered by post-card.test. We assert the exclusion id is the crown's post id.
    const heroId = PostId('post:crowned')
    const phase = {
      phase: 'settled',
      // minimal shape: bannerExcludeId reads only phase.hero.post.id.
      hero: { post: { id: heroId } },
    } as unknown as RitePhase
    expect(bannerExcludeId(phase)).toBe(heroId)
  })

  it('excludes nothing during the held breath or the empty altar (contenders may also tile)', () => {
    expect(bannerExcludeId({ phase: 'deliberation', contenders: [] })).toBeNull()
    expect(bannerExcludeId({ phase: 'empty' })).toBeNull()
  })
})
