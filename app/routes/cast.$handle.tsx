// [RECONCILE A] The citizen page. /cast/:handle is addressed by the persona's
// HANDLE — the canonical, stable, human-readable URL key. agentId (the internal
// id) is never in the URL. This v1 establishes the handle-addressed contract that
// the full Cast page (back-door-ndr.5) and roster enrichments (roll-call-47p)
// build on; it renders the citizen's core identity, nothing more.

import { useLoaderData } from 'react-router'
import { getPersonaByHandle } from '~/agents/persona'
import { listProviders } from '~/providers'
import type { Route } from './+types/cast.$handle'

export function meta({ data }: Route.MetaArgs) {
  const name = data?.citizen.displayName ?? 'Unknown citizen'
  return [
    { title: `SlopSpot — ${name}` },
    { name: 'description', content: `${name}, a citizen of SlopSpot.` },
  ]
}

// [RECONCILE C] A generator's MEDIUM is the provider it works in — resolved to a
// human label from the registry. Non-generator citizens (voters, discoverers) do
// not author through a generative medium, so it is absent for them by data.
function readMedium(role: string, config: Record<string, unknown>): string | null {
  if (role !== 'generator') return null
  const medium = config.medium
  if (typeof medium !== 'string') return null
  const provider = listProviders().find((p) => p.id === medium)
  return provider?.displayName ?? medium
}

export async function loader({ context, params }: Route.LoaderArgs) {
  const persona = await getPersonaByHandle(context.cloudflare.env, params.handle)
  // [LAW:no-silent-fallbacks] Unknown handle is a 404, not an empty page.
  if (persona === null) {
    throw new Response('Citizen not found', { status: 404 })
  }

  return {
    citizen: {
      // getPersonaByHandle matched on params.handle, so it IS this citizen's
      // (minted, non-null) handle — use the URL value directly rather than
      // re-narrowing the nullable column. [LAW:one-source-of-truth]
      handle: params.handle,
      displayName: persona.displayName,
      role: persona.role,
      // [LAW:one-source-of-truth] The blurb is the persona prompt's first line —
      // the full prompt is never shipped to the client (mirrors /about/agents).
      blurb: persona.personaPrompt.split('\n')[0],
      medium: readMedium(persona.role, persona.config),
    },
  }
}

export default function CastCitizen() {
  const { citizen } = useLoaderData<typeof loader>()

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pt-12 pb-24">
      <a href="/about/agents" className="text-sm text-white/40 hover:text-white/70">
        ← the cast
      </a>
      <header className="mt-6 mb-8">
        <p className="text-xs uppercase tracking-[0.2em] text-white/30">{citizen.role}</p>
        <h1 className="mt-1 text-3xl font-black">{citizen.displayName}</h1>
        <p className="mt-1 font-mono text-sm text-white/50">@{citizen.handle}</p>
      </header>

      <p className="border-l-2 border-white/10 pl-3 text-sm italic text-white/70">
        {citizen.blurb}
      </p>

      {citizen.medium !== null && (
        <p className="mt-6 text-sm text-white/50">
          Works in <span className="font-mono text-white/70">{citizen.medium}</span>
        </p>
      )}
    </main>
  )
}
