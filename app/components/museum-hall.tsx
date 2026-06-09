import { Link } from 'react-router'
import type { RiteLens } from '~/lib/domain'
import { lensesInHall, type HallId } from '~/lib/rite'
import { MARK_TONE } from '~/lib/crown-tone'
import type { MuseumEntry, MuseumHallData } from '~/db/museum'
import type { Utterance } from '~/lib/voice'
import { PROPRIETOR, type ProprietorLine } from '~/lib/proprietor'

// THE MUSEUM HALL — the permanent, browsable hall the crown records accrete into
// (design-docs/the-daily-rite.md §"Where the crowned go"). One component, two instances:
// the Calendar of Saints (the venerated) and the Rogues' Gallery (the beautiful monsters).
// What differs between them is DATA — the lens partition, the title, the voice — so this is
// one Hall, not two. [LAW:one-type-per-behavior]

// [LAW:types-are-the-program] The hall's chrome as a total map over HallId — a third hall
// breaks this literal at compile time. The empty line is the Proprietor's honest quiet when
// a hall is still bare (sparse-but-honest is the museum-retention loop starting, not a bug).
// [LAW:one-source-of-truth][LAW:make-it-impossible] The empty line is the Proprietor's voice,
// so it is a ProprietorLine sourced from proprietor.ts — its only home. The brand makes an
// inline raw string in this slot a compile error, not a leak a future audit has to re-find.
const HALL_CHROME: Record<HallId, { title: string; tagline: string; empty: ProprietorLine }> = {
  saints: {
    title: 'The Calendar of Saints',
    tagline: "the city's honoured dead — every canonisation, kept",
    empty: PROPRIETOR.emptySaints,
  },
  rogues: {
    title: "The Rogues' Gallery",
    tagline: "the city's hall of beautiful monsters",
    empty: PROPRIETOR.emptyRogues,
  },
}

// [LAW:types-are-the-program] Each lens's section heading — a total map over RiteLens, so an
// eighth lens breaks the build until it is named. The hall only renders the headings of the
// lenses it holds (lensesInHall), but the map is total so no lens can slip in unlabelled.
const LENS_HEADING: Record<RiteLens, string> = {
  saint: 'The Sainted',
  relic: 'The Relics',
  martyr: 'The Martyrs',
  miracle: 'The Miracles',
  confession: 'The Confessions',
  villain: 'The Villains',
  heretic: 'The Heretics',
}

// [LAW:dataflow-not-control-flow] The decree is the Proprietor's whole Utterance — a spoken
// line is quoted; a meant silence (a withheld decree) renders as the silence it is, never an
// empty quote. The kind is the discriminator, not a truthiness check on the text.
function Decree({ decree }: { decree: Utterance }) {
  switch (decree.kind) {
    case 'spoke':
      return (
        <p className="mt-2 font-civic text-sm italic leading-snug text-bone/80">
          &ldquo;{decree.text}&rdquo;
        </p>
      )
    case 'withheld':
      return (
        <p className="mt-2 font-terminal text-[11px] uppercase tracking-[0.2em] text-ash">
          — the proprietor held his silence —
        </p>
      )
    default: {
      const _exhaustive: never = decree
      return _exhaustive
    }
  }
}

function Tile({ entry }: { entry: MuseumEntry }) {
  // [LAW:one-source-of-truth] The tile's tone is the shared MARK_TONE — the same text+border
  // identity the card's eternal mark wears, so a tile and a card of the same mark never drift.
  const tone = MARK_TONE[entry.mark]
  return (
    <article className={`overflow-hidden rounded-lg border bg-panel/60 ${tone.border}`}>
      <Link to={`/p/${entry.postId}`} aria-label="the crowned slop" className="block">
        <img
          src={entry.media.url}
          alt={entry.media.alt ?? ''}
          width={entry.media.w}
          height={entry.media.h}
          loading="lazy"
          className="aspect-square w-full object-cover transition hover:opacity-90"
        />
      </Link>
      <div className="px-3 py-3">
        <p className="flex items-center justify-between font-terminal text-[11px] uppercase tracking-[0.2em]">
          <span className={tone.text}>✚ presided by {entry.presiding.displayName}</span>
          <span className="text-ash">{entry.riteDay}</span>
        </p>
        <Decree decree={entry.decree} />
      </div>
    </article>
  )
}

// [LAW:dataflow-not-control-flow] Sections are the hall's lenses folded over: every lens in
// the hall is mapped, and an empty lens drops out by data (no entries → no section), never a
// guard on "does this lens have any." The entries arrive newest-first from the reader.
function LensSection({ lens, entries }: { lens: RiteLens; entries: readonly MuseumEntry[] }) {
  return (
    <section className="mb-12">
      <h2 className="mb-4 font-placard text-2xl font-black tracking-tight text-bone">
        {LENS_HEADING[lens]}
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {entries.map((e) => (
          <Tile key={e.postId} entry={e} />
        ))}
      </div>
    </section>
  )
}

export function MuseumHall({ hall, entries }: MuseumHallData) {
  const chrome = HALL_CHROME[hall]
  // [LAW:dataflow-not-control-flow] Section order is the hall's lens order; an empty lens
  // group is dropped by data so only inhabited sections render. The other hall is the one
  // this hall is NOT — a pure pair, no second source.
  const sections = lensesInHall(hall)
    .map((lens) => ({ lens, items: entries.filter((e) => e.lens === lens) }))
    .filter((s) => s.items.length > 0)
  const other: HallId = hall === 'saints' ? 'rogues' : 'saints'

  return (
    <main className="w-full px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10 border-b border-votive/15 pb-7">
          <p className="mb-2 font-terminal text-[11px] uppercase tracking-[0.35em] text-ash">
            <Link to="/" className="transition-colors hover:text-votive/70">
              ·· back to the floor ··
            </Link>
          </p>
          <h1 className="font-placard text-5xl font-black leading-none tracking-tight text-bone">
            {chrome.title}
          </h1>
          <p className="mt-4 font-civic text-xs font-medium uppercase tracking-[0.3em] text-ash">
            ·· {chrome.tagline} ··
          </p>
        </header>

        {/* [LAW:dataflow-not-control-flow] Presence of crowns decides the body: the halls, or
            the Proprietor's honest quiet. An empty hall is characterful, not broken — the
            crown means something because it can be withheld. */}
        {sections.length === 0 ? (
          <p className="rounded-lg border border-dashed border-ash/30 px-4 py-16 text-center font-terminal text-sm text-ash">
            {chrome.empty}
          </p>
        ) : (
          sections.map((s) => <LensSection key={s.lens} lens={s.lens} entries={s.items} />)
        )}

        <footer className="mt-12 flex items-center justify-between gap-4 border-t border-votive/15 pt-6 font-terminal text-xs text-ash">
          <Link to={`/${other}`} className="transition-colors hover:text-votive/70">
            {HALL_CHROME[other].title} →
          </Link>
          <Link to="/cast" className="transition-colors hover:text-votive/70">
            the cast
          </Link>
        </footer>
      </div>
    </main>
  )
}
