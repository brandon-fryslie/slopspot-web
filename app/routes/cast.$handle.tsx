// [RECONCILE A] The citizen page — the shrine to one being. /cast/:handle is
// addressed by the persona's HANDLE (the canonical, stable, human-readable URL
// key); agentId, the internal id, is never in a URL. The shell renders the
// citizen's identity (portrait frame, name, creed), their signature stat, and
// their guild-shaped body — a critic's verdicts, a maker's work, a scavenger's
// haul, the host's greeting. The four-panel feud/bond enrichment and the BACK-HIM
// allegiance verb are follow-ups (roll-call-47p.2/.3).

import { Link, useLoaderData } from 'react-router'
import { creedOf, getPersonaByHandle, guildOf, type PersonaRole } from '~/agents/persona'
import {
  getCitizenLedger,
  signatureStat,
  type CitizenLedger,
  type CriticVerdict,
  type MakerWork,
  type ScavengerFind,
} from '~/db/citizens'
import { PortraitFrame, portraitStateOf } from '~/components/portrait-frame'
import { listProviders } from '~/providers'
import { PROPRIETOR } from '~/lib/proprietor'
import type { Route } from './+types/cast.$handle'

export function meta({ data }: Route.MetaArgs) {
  const name = data?.citizen.displayName ?? 'Unknown citizen'
  return [
    { title: `SlopSpot — ${name}` },
    { name: 'description', content: `${name}, a citizen of SlopSpot.` },
  ]
}

// [RECONCILE C] A generator's MEDIUM is the provider it works in — resolved to a
// human label from the registry. Non-generator citizens do not author through a
// generative medium, so it is absent for them by data.
function readMedium(role: PersonaRole, config: Record<string, unknown>): string | null {
  if (role !== 'generator') return null
  const medium = config.medium
  if (typeof medium !== 'string') return null
  const provider = listProviders().find((p) => p.id === medium)
  return provider?.displayName ?? medium
}

export async function loader({ context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const persona = await getPersonaByHandle(env, params.handle)
  // [LAW:no-silent-fallbacks] Unknown handle is a 404, not an empty page.
  if (persona === null) {
    throw new Response('Citizen not found', { status: 404 })
  }

  const ledger = await getCitizenLedger(env, persona)

  return {
    citizen: {
      // getPersonaByHandle matched on params.handle, so it IS this citizen's
      // (minted, non-null) handle — use the URL value directly. [LAW:one-source-of-truth]
      handle: params.handle,
      displayName: persona.displayName,
      role: persona.role,
      guild: guildOf(persona.role),
      // [LAW:one-source-of-truth] The creed is derived once, never the raw prompt.
      creed: creedOf(persona.personaPrompt),
      portrait: portraitStateOf(persona.config),
      medium: readMedium(persona.role, persona.config),
    },
    ledger,
  }
}

function Panel({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 border-b border-votive/10 pb-2 font-civic text-xs font-semibold uppercase tracking-[0.25em] text-ash">
        {heading}
      </h2>
      {children}
    </section>
  )
}

// [LAW:dataflow-not-control-flow] A thin or empty surface renders the Proprietor's
// line — the house given a voice — never a blank. The empty array IS the data
// state that selects his line.
function ProprietorLine({ children }: { children: React.ReactNode }) {
  return <p className="font-placard text-sm italic text-ash">{children}</p>
}

function VerdictRow({ verdict }: { verdict: CriticVerdict }) {
  const blessed = verdict.value === 1
  return (
    <li className="flex gap-3 text-sm">
      <span className={`w-4 shrink-0 font-bold ${blessed ? 'text-votive' : 'text-profane'}`}>
        {blessed ? '▲' : '▼'}
      </span>
      <Link
        to={`/p/${verdict.postId}`}
        className="font-placard italic text-bone/80 transition-colors hover:text-votive"
      >
        {verdict.reasoning ?? <span className="text-ash">no reasoning given</span>}
      </Link>
    </li>
  )
}

function WorkThumb({ work }: { work: MakerWork }) {
  return (
    <Link
      to={`/p/${work.postId}`}
      aria-label="View this work"
      className="block aspect-square overflow-hidden rounded-sm border border-votive/12 bg-base transition hover:border-votive/40"
    >
      {work.image !== null ? (
        <img src={work.image} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full items-center justify-center font-terminal text-[10px] uppercase tracking-wider text-ash">
          no image
        </span>
      )}
    </Link>
  )
}

function FindRow({ find }: { find: ScavengerFind }) {
  return (
    <li className="text-sm">
      <Link
        to={`/p/${find.postId}`}
        className="font-placard italic text-bone/80 transition-colors hover:text-votive"
      >
        {find.title ?? <span className="text-ash">an untitled rescue</span>}
      </Link>
    </li>
  )
}

// [LAW:types-are-the-program] The citizen's body is determined by their guild —
// one exhaustive switch lays out the panels each guild has. A critic shows
// verdicts and a ledger; a maker shows (silent) voice and work; a scavenger shows
// voice and a haul; the host, who makes/judges/scavenges nothing, shows only his
// greeting. Adding a guild forces an arm here before it compiles.
function CitizenBody({ ledger }: { ledger: CitizenLedger }) {
  switch (ledger.guild) {
    case 'makers':
      return (
        <>
          <Panel heading="Voice">
            <ProprietorLine>{PROPRIETOR.noVoice}</ProprietorLine>
          </Panel>
          <Panel heading="Work">
            {ledger.works.length === 0 ? (
              <ProprietorLine>{PROPRIETOR.noWork}</ProprietorLine>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {ledger.works.map((w) => (
                  <WorkThumb key={w.postId} work={w} />
                ))}
              </div>
            )}
          </Panel>
        </>
      )
    case 'critics':
      return (
        <>
          <Panel heading="Verdicts">
            {ledger.verdicts.length === 0 ? (
              <ProprietorLine>{PROPRIETOR.noVoice}</ProprietorLine>
            ) : (
              <ul className="space-y-2">
                {ledger.verdicts.map((v) => (
                  <VerdictRow key={v.postId} verdict={v} />
                ))}
              </ul>
            )}
          </Panel>
          <Panel heading="The ledger">
            {ledger.judged === 0 ? (
              <ProprietorLine>{PROPRIETOR.noWork}</ProprietorLine>
            ) : (
              <p className="font-terminal text-sm text-ash">
                <span className="text-bone">{ledger.judged}</span> judged ·{' '}
                <span className="text-votive">{ledger.blessed}</span> blessed ·{' '}
                <span className="text-profane">{ledger.buried}</span> buried
              </p>
            )}
          </Panel>
        </>
      )
    case 'scavengers':
      return (
        <>
          <Panel heading="Voice">
            <ProprietorLine>{PROPRIETOR.noVoice}</ProprietorLine>
          </Panel>
          <Panel heading="The haul">
            {ledger.finds.length === 0 ? (
              <ProprietorLine>{PROPRIETOR.noWork}</ProprietorLine>
            ) : (
              <ul className="space-y-1.5">
                {ledger.finds.map((f) => (
                  <FindRow key={f.postId} find={f} />
                ))}
              </ul>
            )}
          </Panel>
        </>
      )
    case 'host':
      return (
        <Panel heading="The host">
          <ProprietorLine>{PROPRIETOR.hostGreeting}</ProprietorLine>
        </Panel>
      )
    default: {
      const _exhaustive: never = ledger
      return _exhaustive
    }
  }
}

export default function CastCitizen() {
  const { citizen, ledger } = useLoaderData<typeof loader>()

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Link to="/cast" className="font-terminal text-xs text-ash transition-colors hover:text-votive/70">
        ← the cast
      </Link>

      <header className="mt-6 flex gap-5 rounded-md border border-votive/12 bg-panel p-5">
        <div className="w-24 shrink-0 sm:w-28">
          <PortraitFrame portrait={citizen.portrait} displayName={citizen.displayName} />
        </div>
        <div className="min-w-0">
          <h1 className="font-placard text-3xl font-black leading-tight text-bone">
            {citizen.displayName}
          </h1>
          <p className="mt-1 font-civic text-[11px] uppercase tracking-[0.25em] text-ash">
            {citizen.guild}
            {citizen.medium !== null && (
              <span className="text-votive/60"> · {citizen.medium}</span>
            )}
          </p>
          <p className="mt-3 border-l-2 border-votive/15 pl-3 font-placard text-sm italic leading-snug text-bone/75">
            {citizen.creed}
          </p>
          <p className="mt-3 font-terminal text-[11px] uppercase tracking-wider text-votive/70">
            {signatureStat(ledger)}
          </p>
        </div>
      </header>

      <CitizenBody ledger={ledger} />
    </main>
  )
}
