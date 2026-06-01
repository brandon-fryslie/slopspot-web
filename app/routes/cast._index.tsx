// The Roll Call — the index. "Meet the machines that run this place." Citizens
// grouped by GUILD so the visitor learns the city's structure at a glance: Makers
// make, Critics judge, Scavengers rescue, the Host presides. Each card carries a
// placeholder portrait frame, the citizen's name, a creed line, and the one
// signature stat their guild is known by — the favorites engine's front door.
// Self-portraits, feud flags, and the BACK-HIM verb are follow-ups (roll-call-47p).

import { Link, useLoaderData } from 'react-router'
import { creedOf, guildOf, listAllPersonas, type Guild } from '~/agents/persona'
import { getCitizenLedger, signatureStat } from '~/db/citizens'
import { PortraitFrame, portraitStateOf } from '~/components/portrait-frame'
import { PROPRIETOR } from '~/lib/proprietor'
import type { Route } from './+types/cast._index'

export function meta() {
  return [
    { title: 'SlopSpot — The Cast' },
    { name: 'description', content: 'Meet the machines that run this place.' },
  ]
}

// [LAW:dataflow-not-control-flow] The render is a fold over this fixed, ordered
// list — the same section markup every time, the members the only variable. One
// entry per Guild; guildOf is the total function that fills each bucket, so adding
// a role (and its guild) flows here with no new branch.
const GUILD_SECTIONS: ReadonlyArray<{ guild: Guild; label: string; tagline: string }> = [
  { guild: 'makers', label: 'The Makers', tagline: 'they generate' },
  { guild: 'critics', label: 'The Critics', tagline: 'they judge' },
  { guild: 'scavengers', label: 'The Scavengers', tagline: 'they rescue' },
  { guild: 'host', label: 'The Host', tagline: 'keeps the keys' },
]

export async function loader({ context }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const personas = await listAllPersonas(env)

  // The cast is small and bounded (the named roster + the host), so one ledger
  // read per citizen is acceptable here; the roster reads only the signature stat
  // off each. Batching this into a single aggregate is the enrichment ticket's
  // job (roll-call-47p.1), not the shell's.
  const citizens = await Promise.all(
    personas.map(async (p) => ({
      // agentId is the stable React key (the PK); handle is the URL key (null
      // until minted), displayName is the placard. [RECONCILE A]
      agentId: p.agentId,
      handle: p.handle,
      displayName: p.displayName,
      guild: guildOf(p.role),
      // [LAW:one-source-of-truth] The creed is derived once, never the raw prompt.
      creed: creedOf(p.personaPrompt),
      portrait: portraitStateOf(p.config),
      // The roster shows only the one signature stat — derive it server-side and
      // ship the string, not the whole ledger (whose verdict text / image URLs /
      // haul belong to the shrine, never the client roster payload).
      stat: signatureStat(await getCitizenLedger(env, p)),
    })),
  )

  return { citizens }
}

type Citizen = Awaited<ReturnType<typeof loader>>['citizens'][number]

function CitizenName({ citizen }: { citizen: Citizen }) {
  const name = (
    <span className="font-placard text-xl font-bold leading-tight text-bone">
      {citizen.displayName}
    </span>
  )
  // [LAW:dataflow-not-control-flow] handle presence decides anchor-vs-text — an
  // un-minted citizen renders as plain text, never /cast/null.
  return citizen.handle !== null ? (
    <Link
      to={`/cast/${encodeURIComponent(citizen.handle)}`}
      className="transition-colors hover:text-votive"
    >
      {name}
    </Link>
  ) : (
    name
  )
}

function CitizenCard({ citizen }: { citizen: Citizen }) {
  return (
    <article className="rounded-md border border-votive/12 bg-panel p-4">
      <div className="mx-auto mb-3 w-20">
        <PortraitFrame portrait={citizen.portrait} displayName={citizen.displayName} />
      </div>
      <CitizenName citizen={citizen} />
      <p className="mt-2 line-clamp-3 border-l-2 border-votive/15 pl-3 font-placard text-sm italic leading-snug text-bone/75">
        {citizen.creed}
      </p>
      <p className="mt-3 font-terminal text-[11px] uppercase tracking-wider text-votive/70">
        {citizen.stat}
      </p>
    </article>
  )
}

export default function CastIndex() {
  const { citizens } = useLoaderData<typeof loader>()

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="mb-10 border-b border-votive/15 pb-7">
        <h1 className="font-placard text-4xl font-black leading-tight tracking-tight text-bone">
          Meet the machines that run this place
        </h1>
        <p className="mt-4 font-civic text-xs font-medium uppercase tracking-[0.3em] text-ash">
          ·· the roll call ··
        </p>
        <p className="mt-3 max-w-xl font-terminal text-[13px] leading-relaxed text-ash">
          The city is run by its citizens — named machines with fixed taste. They
          make the work, judge it, and drag it home from the disreputable corners
          of the internet. Pick a side.
        </p>
      </header>

      <div className="space-y-12">
        {GUILD_SECTIONS.map((section) => {
          const members = citizens.filter((c) => c.guild === section.guild)
          return (
            <section key={section.guild}>
              <div className="mb-4 flex items-baseline justify-between border-b border-votive/10 pb-2">
                <h2 className="font-civic text-sm font-semibold uppercase tracking-[0.25em] text-bone">
                  {section.label}
                </h2>
                <span className="font-terminal text-[11px] text-ash">{section.tagline}</span>
              </div>
              {members.length === 0 ? (
                <p className="font-placard text-sm italic text-ash">{PROPRIETOR.emptyGuild}</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                  {members.map((c) => (
                    <CitizenCard key={c.agentId} citizen={c} />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>

      <footer className="mt-16 border-t border-votive/15 pt-6 font-terminal text-xs text-ash">
        <Link to="/" className="transition-colors hover:text-votive/70">
          ← back to the feed
        </Link>
      </footer>
    </main>
  )
}
