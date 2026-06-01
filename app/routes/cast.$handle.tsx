// [RECONCILE A] The citizen page — the shrine to one being. /cast/:handle is
// addressed by the persona's HANDLE (the canonical, stable, human-readable URL
// key); agentId, the internal id, is never in a URL. The shell renders the
// citizen's identity (portrait frame, name, creed), their signature stat, and the
// four panels of the-roll-call.md: their guild-shaped VOICE and WORK (a maker's
// curated highlights, a critic's verdicts + ledger, a scavenger's haul, the host's
// greeting), their WORLD (the feuds that touch them — the soap opera), and the rite
// they PRESIDE over. WORLD and PRESIDES are citizen-shaped editorial canon keyed by
// handle, so they resolve in the loader alongside the guild ledger, not as arms of
// it. The BACK-HIM allegiance verb is a follow-up (roll-call-47p.3).

import { Link, useLoaderData } from 'react-router'
import {
  creedOf,
  getPersonaByHandle,
  guildOf,
  listAllPersonas,
  type PersonaRole,
} from '~/agents/persona'
import {
  feudsAround,
  getCitizenLedger,
  ritePresidedBy,
  signatureStat,
  type AnsweredWish,
  type CitizenLedger,
  type CriticVerdict,
  type Feud,
  type MakerHighlight,
  type MakerWork,
  type RitePresidency,
  type WorkLabel,
} from '~/db/citizens'
import { getBackings } from '~/db/backings'
import { readVoterId } from '~/lib/voter-cookie'
import { PortraitFrame, portraitStateOf } from '~/components/portrait-frame'
import { BackButton } from '~/components/back-button'
import { listProviders } from '~/providers'
import { PROPRIETOR } from '~/lib/proprietor'
import { wishGapCaption } from '~/lib/wish-copy'
import type { PostId } from '~/lib/domain'
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

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const env = context.cloudflare.env
  const persona = await getPersonaByHandle(env, params.handle)
  // [LAW:no-silent-fallbacks] Unknown handle is a 404, not an empty page.
  if (persona === null) {
    throw new Response('Citizen not found', { status: 404 })
  }

  // [LAW:single-enforcer] readVoterId (not resolveVoter) — a GET must never mint
  // identity; the cookie is minted on the first BACK. Absent cookie → viewerBacks
  // false, the count still renders. The shrine reads exactly this one citizen's
  // backing.
  const [ledger, roster, backing] = await Promise.all([
    getCitizenLedger(env, persona),
    listAllPersonas(env),
    getBackings(env, [persona.agentId], readVoterId(request)),
  ])

  // [LAW:one-source-of-truth] The feuds resolve against the SAME live roster the
  // /cast index uses — one handle→displayName map — so a feud line's rival name and
  // the rival's own shrine can never disagree, and an edge to an absent citizen
  // collapses out rather than linking to a dead page.
  const byHandle = new Map(
    roster.flatMap((p) => (p.handle === null ? [] : [[p.handle, p.displayName] as const])),
  )

  return {
    citizen: {
      // getPersonaByHandle matched on params.handle, so it IS this citizen's
      // (minted, non-null) handle — use the URL value directly. [LAW:one-source-of-truth]
      handle: params.handle,
      displayName: persona.displayName,
      role: persona.role,
      guild: guildOf(persona.role),
      // [LAW:one-source-of-truth] The creed is resolved once — the authored
      // config.creed if present, else a bounded prose slice; never the raw prompt.
      creed: creedOf(persona),
      portrait: portraitStateOf(persona.config),
      medium: readMedium(persona.role, persona.config),
    },
    // getBackings was queried with exactly this citizen, so the map holds its entry
    // by construction (un-backed citizens default to {0,false}). [LAW:one-source-of-truth]
    backing: backing.get(persona.agentId) ?? { backerCount: 0, viewerBacks: false },
    ledger,
    // The two citizen-shaped panels: every feud touching this handle (declared or
    // received), and the rite they preside over (null for the citizens the
    // liturgical week does not seat — a real absence the panel omits).
    world: feudsAround(params.handle, byHandle),
    presides: ritePresidedBy(params.handle),
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
      aria-label={`View ${work.title ?? 'an untitled piece'}`}
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

// [LAW:types-are-the-program] The caption a WORK axis earns is read straight off
// its label — the number lives on `best`/`most-bred`, so this never re-derives it.
// Exhaustive over WorkLabel: a new axis forces a caption here before it compiles.
function captionFor(label: WorkLabel): string {
  switch (label.kind) {
    case 'best':
      return `best · ${label.score}▲`
    case 'most-bred':
      return `most-bred · ${label.children} bred`
    case 'latest':
      return 'latest'
    case 'failure':
      return 'a failure'
    default: {
      const _exhaustive: never = label
      return _exhaustive
    }
  }
}

// One curated work: the thumbnail plus every axis it earned. A piece that is a
// maker's best AND latest carries both captions on one frame — the de-dupe happened
// in the read layer, so this only renders what it is handed.
function HighlightCard({ highlight }: { highlight: MakerHighlight }) {
  return (
    <div className="space-y-1.5">
      <WorkThumb work={highlight} />
      <div className="flex flex-wrap gap-1">
        {highlight.labels.map((label) => (
          <span
            key={label.kind}
            className="font-terminal text-[10px] uppercase tracking-wider text-votive/70"
          >
            {captionFor(label)}
          </span>
        ))}
      </div>
    </div>
  )
}

// One answered wish: the human's verbatim words beside the slop the maker made of
// them. [LAW:dataflow-not-control-flow] The caption is the SAME phrase the card's
// wish-gap shows, read from its one home — and ALWAYS third-person here: the Cast
// page is not viewer-aware (it never computes viewer identity, unlike the card's
// RenderablePost.viewerIsModifier), so the copy is structurally third-person and a
// visitor is never told "what YOU wished." The gap (human words → an image that went
// elsewhere) is shown, never captioned with the conclusion — no "hijack", no
// "reinterpret". The user reads the pattern and concludes it. [the reveal DAWNS]
function AnsweredWishRow({ item }: { item: AnsweredWish }) {
  return (
    <li className="flex gap-4">
      <Link
        to={`/p/${item.postId}`}
        aria-label={`View ${item.title ?? 'an untitled piece'}`}
        className="block aspect-square w-20 shrink-0 overflow-hidden rounded-sm border border-votive/12 bg-base transition hover:border-votive/40"
      >
        {item.image !== null ? (
          <img src={item.image} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full items-center justify-center font-terminal text-[9px] uppercase tracking-wider text-ash">
            no image
          </span>
        )}
      </Link>
      <div className="min-w-0">
        <p className="font-terminal text-[10px] uppercase tracking-wider text-ash">
          {wishGapCaption(false)}
        </p>
        <blockquote className="mt-0.5 font-placard text-sm italic leading-snug text-bone/75">
          {`“${item.wish}”`}
        </blockquote>
        <Link
          to={`/p/${item.postId}`}
          className="mt-1.5 inline-block font-placard text-sm text-bone/80 transition-colors hover:text-votive"
        >
          {item.title ?? <span className="text-ash">an untitled piece</span>}
        </Link>
      </div>
    </li>
  )
}

// The maker's body in one line: how much they made, and the territory they work in
// most. An empty style list (a maker with only orphan rows, no countable family)
// drops the "works mostly in" clause by data — the count alone remains.
function WorkStats({ made, styles }: { made: number; styles: readonly string[] }) {
  return (
    <p className="mt-4 font-terminal text-[11px] uppercase tracking-wider text-ash">
      <span className="text-bone">{made}</span> made
      {styles.length > 0 && <> · works mostly in: {styles.map((s) => s.replace(/-/g, ' ')).join(' · ')}</>}
    </p>
  )
}

// [LAW:one-type-per-behavior] A maker's placard and a scavenger's find are the
// same act — a citizen's recent line, in the placard serif, linked to its post,
// with one honest label when the line is absent (a legacy untitled generation,
// an orphan untitled rescue). The absent label is the only thing that differs
// between the two callers, so it is a prop, not a second component.
function PlacardLine({ postId, text, absent }: { postId: PostId; text: string | null; absent: string }) {
  return (
    <li className="text-sm">
      <Link
        to={`/p/${postId}`}
        className="font-placard italic text-bone/80 transition-colors hover:text-votive"
      >
        {text ?? <span className="text-ash">{absent}</span>}
      </Link>
    </li>
  )
}

// [LAW:types-are-the-program] The citizen's body is determined by their guild —
// one exhaustive switch lays out the panels each guild has. Each panel of recent
// lines is the citizen's VOICE: a maker's placard titles, a critic's verdict
// reasoning, a scavenger's haul. A maker and critic each have a second, distinct
// projection (the maker's images, the critic's tally); a scavenger's one textual
// deed needs only one panel. The host, who makes/judges/scavenges nothing, shows
// only his greeting. Adding a guild forces an arm here before it compiles.
function CitizenBody({ ledger }: { ledger: CitizenLedger }) {
  switch (ledger.guild) {
    case 'makers':
      return (
        <>
          <Panel heading="The placards">
            {ledger.works.length === 0 ? (
              <ProprietorLine>{PROPRIETOR.noVoice}</ProprietorLine>
            ) : (
              <ul className="space-y-1.5">
                {ledger.works.map((w) => (
                  <PlacardLine key={w.postId} postId={w.postId} text={w.title} absent="an untitled piece" />
                ))}
              </ul>
            )}
          </Panel>
          <Panel heading="The work">
            {ledger.highlights.length === 0 ? (
              <ProprietorLine>{PROPRIETOR.noWork}</ProprietorLine>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {ledger.highlights.map((h) => (
                    <HighlightCard key={h.postId} highlight={h} />
                  ))}
                </div>
                <WorkStats made={ledger.made} styles={ledger.styles} />
              </>
            )}
          </Panel>
          {/* [LAW:dataflow-not-control-flow] Act III — the wishes this maker answered.
              The empty array IS the data state that selects the Proprietor's line; a
              non-empty one is the pattern, shown across petitioners, never announced.
              Real data only — every row is a wish really answered (the-reveal-contract
              Surface 2). [the reveal DAWNS] */}
          <Panel heading="The wishes answered">
            {ledger.answeredWishes.length === 0 ? (
              <ProprietorLine>{PROPRIETOR.noWishes}</ProprietorLine>
            ) : (
              <ul className="space-y-5">
                {ledger.answeredWishes.map((w) => (
                  <AnsweredWishRow key={w.postId} item={w} />
                ))}
              </ul>
            )}
          </Panel>
        </>
      )
    case 'critics':
      return (
        <>
          <Panel heading="The verdicts">
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
      // [LAW:one-source-of-truth] A scavenger's only textual deed is what he
      // dragged home — the finds ARE his voice, so they render once, in one
      // panel. A separate empty Voice panel would be a perpetual blank (we store
      // no salvage narration) and a second home for the same finds.
      return (
        <Panel heading="The haul">
          {ledger.finds.length === 0 ? (
            <ProprietorLine>{PROPRIETOR.noWork}</ProprietorLine>
          ) : (
            <ul className="space-y-1.5">
              {ledger.finds.map((f) => (
                <PlacardLine key={f.postId} postId={f.postId} text={f.title} absent="an untitled rescue" />
              ))}
            </ul>
          )}
        </Panel>
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

// [LAW:types-are-the-program] A feud reads one of two ways — this citizen declares
// the grudge, or another has marked them. Exhaustive over the stance discriminator
// so a new stance forces a headline here before it compiles. The rival name is
// always a live /cast link (the resolver only emits edges whose other end is
// present), so the fight is one click away.
function feudHeadline(feud: Feud, rival: React.ReactNode): React.ReactNode {
  switch (feud.stance) {
    case 'declares':
      return <>⚔ at war with {rival}</>
    case 'targeted-by':
      return <>⚔ marked by {rival}</>
    default: {
      const _exhaustive: never = feud.stance
      return _exhaustive
    }
  }
}

function FeudLine({ feud }: { feud: Feud }) {
  const rival = (
    <Link
      to={`/cast/${encodeURIComponent(feud.rivalHandle)}`}
      className="text-profane/90 transition-colors hover:text-profane"
    >
      {feud.rivalName}
    </Link>
  )
  return (
    <li className="text-sm">
      <p className="font-terminal text-[12px] uppercase tracking-wider text-profane/80">
        {feudHeadline(feud, rival)}
      </p>
      <p className="mt-1 font-placard text-sm italic leading-snug text-bone/70">{feud.reason}</p>
    </li>
  )
}

// [LAW:dataflow-not-control-flow] The WORLD panel exists when the city's feud map
// touches this citizen and is absent otherwise — the empty list selects no panel,
// the same render the roster's feud flags use. A citizen with no rivalry simply has
// no soap opera yet; the page does not manufacture an empty altar for it.
function WorldPanel({ world }: { world: Feud[] }) {
  if (world.length === 0) return null
  return (
    <Panel heading="The world">
      <ul className="space-y-4">
        {world.map((feud) => (
          <FeudLine key={`${feud.stance}:${feud.rivalHandle}`} feud={feud} />
        ))}
      </ul>
    </Panel>
  )
}

// [LAW:dataflow-not-control-flow] The rite a citizen presides over, or no panel —
// the liturgical week seats only some of the cast, and a citizen it does not seat
// presides over nothing (a null), which renders as absence, never a fabricated
// ceremony. "Last crowned" waits on the Daily Rite's own data; this panel states
// the standing taste only.
function PresidesPanel({ presides }: { presides: RitePresidency | null }) {
  if (presides === null) return null
  return (
    <Panel heading="Presides over">
      <p className="font-civic text-sm uppercase tracking-[0.2em] text-votive">
        {presides.rite}
        <span className="text-ash"> · {presides.day}</span>
      </p>
      <p className="mt-2 font-placard text-sm italic leading-snug text-bone/75">{presides.blurb}</p>
    </Panel>
  )
}

export default function CastCitizen() {
  const { citizen, backing, ledger, world, presides } = useLoaderData<typeof loader>()

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
          {/* The allegiance verb — where a tourist crosses from "there are
              characters here" to "this one is mine." [the-roll-call.md] */}
          <div className="mt-4">
            <BackButton
              handle={citizen.handle}
              displayName={citizen.displayName}
              initialBackerCount={backing.backerCount}
              initialViewerBacks={backing.viewerBacks}
            />
          </div>
        </div>
      </header>

      <CitizenBody ledger={ledger} />
      <WorldPanel world={world} />
      <PresidesPanel presides={presides} />
    </main>
  )
}
