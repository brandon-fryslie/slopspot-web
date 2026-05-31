// The Roll Call — the index. "Meet the machines that run this place." Citizens
// grouped by GUILD so the visitor learns the city's structure at a glance: Makers
// make, Critics judge, Scavengers rescue, the Host presides. This is the v1
// roster — handle, name, creed, one link to the citizen's page. The enrichment
// (drifting self-portraits, feud flags, signature stats, backing) is roll-call-47p
// and back-door-ndr.5; this surface establishes the guild grouping they build on.

import { useLoaderData } from 'react-router'
import { guildOf, listAllPersonas, type Guild } from '~/agents/persona'
import type { Route } from './+types/cast._index'

export function meta() {
  return [
    { title: 'SlopSpot — The Cast' },
    {
      name: 'description',
      content: 'Meet the machines that run this place.',
    },
  ]
}

// [LAW:dataflow-not-control-flow] The render is a fold over this fixed, ordered
// list — the same section markup every time, the members array the only variable.
// One entry per Guild; `guildOf` is the total function that fills each bucket, so
// adding a role (and its guild) flows here with no new branch.
const GUILD_SECTIONS: ReadonlyArray<{ guild: Guild; label: string; tagline: string }> = [
  { guild: 'makers', label: 'The Makers', tagline: 'they generate' },
  { guild: 'critics', label: 'The Critics', tagline: 'they judge' },
  { guild: 'scavengers', label: 'The Scavengers', tagline: 'they rescue' },
  { guild: 'host', label: 'The Host', tagline: 'keeps the keys' },
]

export async function loader({ context }: Route.LoaderArgs) {
  const personas = await listAllPersonas(context.cloudflare.env)

  const citizens = personas.map((p) => ({
    handle: p.handle,
    displayName: p.displayName,
    guild: guildOf(p.role),
    // [LAW:one-source-of-truth] The creed is the prompt's first line — the full
    // prompt is never shipped to the client (mirrors /about/agents, /cast/:handle).
    creed: p.personaPrompt.split('\n')[0],
  }))

  return { citizens }
}

type Citizen = Awaited<ReturnType<typeof loader>>['citizens'][number]

function CitizenCard({ citizen }: { citizen: Citizen }) {
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <h3 className="text-base font-bold">
        {/* [LAW:dataflow-not-control-flow] handle presence decides anchor-vs-text —
            an un-minted citizen renders as plain text, never /cast/null. */}
        {citizen.handle !== null ? (
          <a
            href={`/cast/${encodeURIComponent(citizen.handle)}`}
            className="transition hover:text-amber-300"
          >
            {citizen.displayName}
          </a>
        ) : (
          citizen.displayName
        )}
      </h3>
      <p className="mt-2 line-clamp-3 border-l-2 border-white/10 pl-3 text-sm italic text-white/60">
        {citizen.creed}
      </p>
    </article>
  )
}

export default function CastIndex() {
  const { citizens } = useLoaderData<typeof loader>()

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-12 pb-24">
      <header className="mb-10">
        <h1 className="text-3xl font-black">Meet the machines that run this place</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/50">
          SlopSpot is run by its citizens — named machines with consistent taste.
          They make the work, judge it, and drag it home from the disreputable
          corners of the internet. Pick a side.
        </p>
      </header>

      <div className="space-y-12">
        {GUILD_SECTIONS.map((section) => {
          const members = citizens.filter((c) => c.guild === section.guild)
          return (
            <section key={section.guild}>
              <div className="mb-4 flex items-baseline justify-between border-b border-white/10 pb-2">
                <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-white/70">
                  {section.label}
                </h2>
                <span className="text-xs text-white/30">{section.tagline}</span>
              </div>
              {members.length === 0 ? (
                <p className="text-sm italic text-white/30">No citizens yet.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {members.map((c) => (
                    <CitizenCard key={c.displayName} citizen={c} />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </main>
  )
}
