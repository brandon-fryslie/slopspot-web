import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router'
import { describe, it, expect } from 'vitest'
import { MuseumHall } from '~/components/museum-hall'
import type { MuseumEntry, MuseumHallData } from '~/db/museum'
import { PostId, type Media } from '~/lib/domain'
import { spoke, withheld } from '~/lib/voice'

// [LAW:behavior-not-structure] Pin what each hall RENDERS for a given read result — the
// title/voice by hall value, the decree by its Utterance kind, the honest empty state —
// without asserting internals. DOM-free (renderToStaticMarkup); StaticRouter supplies the
// Link context the tiles and nav use.
const render = (data: MuseumHallData) =>
  renderToStaticMarkup(
    <StaticRouter location={`/${data.hall}`}>
      <MuseumHall {...data} />
    </StaticRouter>,
  )

const image: Extract<Media, { kind: 'image' }> = {
  kind: 'image',
  url: '/media/' + 'a'.repeat(64),
  w: 512,
  h: 512,
  alt: 'a crowned slop',
}

const entry = (over: Partial<MuseumEntry> & Pick<MuseumEntry, 'postId' | 'lens' | 'mark'>): MuseumEntry => ({
  riteDay: '2026-05-12',
  decree: spoke('Canonised through its flaw.'),
  presiding: { handle: 'vivian', displayName: 'St. Vivian' },
  media: image,
  ...over,
})

describe('MuseumHall — the empty altar speaks', () => {
  it('an empty Calendar of Saints renders the Proprietor’s honest quiet', () => {
    const html = render({ hall: 'saints', entries: [] })
    expect(html).toContain('The Calendar of Saints')
    expect(html).toContain('No saints yet')
  })

  it('an empty Rogues’ Gallery renders its own quiet', () => {
    const html = render({ hall: 'rogues', entries: [] })
    // renderToStaticMarkup escapes the apostrophe in the title (&#x27;), so match the
    // unambiguous, apostrophe-free fragment of the title instead.
    expect(html).toContain('Gallery')
    expect(html).toContain('No monsters yet')
  })
})

describe('MuseumHall — the tiles', () => {
  it('renders a spoken decree, the presiding citizen, the day, and a permalink', () => {
    const html = render({
      hall: 'saints',
      entries: [entry({ postId: PostId('p-saint'), lens: 'saint', mark: 'gold' })],
    })
    expect(html).toContain('The Sainted') // the lens section heading
    expect(html).toContain('Canonised through its flaw.')
    expect(html).toContain('St. Vivian')
    expect(html).toContain('2026-05-12')
    expect(html).toContain('/p/p-saint')
  })

  it('a withheld decree renders the silence, never an empty quote', () => {
    const html = render({
      hall: 'saints',
      entries: [entry({ postId: PostId('p-silent'), lens: 'confession', mark: 'bone', decree: withheld('indifferent') })],
    })
    expect(html).toContain('held his silence')
    // no empty quote marks rendered around nothing
    expect(html).not.toContain('&ldquo;&rdquo;')
  })

  it('groups entries under their lens section in canonical order', () => {
    const html = render({
      hall: 'rogues',
      entries: [
        entry({ postId: PostId('p-v'), lens: 'villain', mark: 'magenta' }),
        entry({ postId: PostId('p-h'), lens: 'heretic', mark: 'magenta' }),
      ],
    })
    // villain section precedes heretic section (RITE_LENSES order).
    expect(html.indexOf('The Villains')).toBeLessThan(html.indexOf('The Heretics'))
  })
})
