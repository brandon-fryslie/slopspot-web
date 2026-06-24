import { Link } from "react-router"
import type { PulseEvent } from "~/db/pulse"
import { MARK_TONE } from "~/lib/crown-tone"
import { PROPRIETOR } from "~/lib/proprietor"
import { markFor } from "~/lib/rite"
import { pulseEventKey } from "~/lib/pulse-key"

// The Pulse strip — "the city breathing". A slow ambient crawl of recent civic
// events below the masthead. font-terminal, votive glow, on the void.
//
// [LAW:dataflow-not-control-flow] The variant decides the render. `eventBody`
// is an exhaustive switch over the discriminated union; nothing branches on
// *whether* to show an event — the list it was given is the list it shows.
//
// Motion respects prefers-reduced-motion: the `.pulse-crawl` utility (app.css)
// animates only when motion is allowed and the same @media query disables it
// otherwise, while Tailwind's motion-reduce: variants turn the horizontal crawl
// into a static vertical list. No JS reads the preference, so SSR and hydration
// agree. The track holds two identical groups; shifting it by one group's width
// (-50%) loops seamlessly.

const maker = (name: string) => <span className="text-bone">{name}</span>

function eventBody(e: PulseEvent) {
  switch (e.kind) {
    case "posted":
      return (
        <>
          {maker(e.persona)} posted <span className="text-votive">{e.title}</span>
        </>
      )
    case "rescued":
      return <>{maker(e.persona)} dragged one in</>
    case "blessed":
      return (
        <>
          {maker(e.persona)} <span className="text-votive">blessed</span> {e.title}
        </>
      )
    case "buried":
      return (
        <>
          {maker(e.persona)} <span className="text-profane">buried</span>{" "}
          <span className="text-ash">{e.title}</span>
        </>
      )
    case "born":
      // The Proprietor's stored welcome line — it already names the newcomer, so render it verbatim.
      return <span className="text-votive">{e.text}</span>
    case "feast": {
      // The saint's icon returns: its presiding citizen named, wearing the crown's own mark tone
      // (the shared MARK_TONE, so a feast line and the saint's card never drift). [LAW:one-source-of-truth]
      const tone = MARK_TONE[markFor(e.lens)]
      return (
        <>
          the feast of {maker(e.persona)}
          <span className={tone.text}> · the {e.lens}</span>
        </>
      )
    }
    default: {
      const _exhaustive: never = e
      return _exhaustive
    }
  }
}

const reasoningOf = (e: PulseEvent): string | undefined =>
  e.kind === "blessed" || e.kind === "buried" ? e.reasoning : undefined

// [LAW:dataflow-not-control-flow] The link target is DATA: a born event is post-less, so it has no
// /p/:id to point at — the renderer reads `undefined` and draws a plain span instead of an anchor.
const hrefOf = (e: PulseEvent): string | undefined => (e.kind === "born" ? undefined : `/p/${e.postId}`)

// `duplicate` marks the second copy that exists ONLY to make the crawl seamless
// (the -50% loop needs two identical groups). Under reduced motion the crawl is
// off, so the copy has no purpose — the same flag hides it (motion-reduce:hidden)
// and marks it aria-hidden, so reduced-motion / screen-reader users get exactly
// one vertical list, never a doubled one.
function EventGroup({ events, duplicate }: { events: PulseEvent[]; duplicate?: boolean }) {
  return (
    <ul
      aria-hidden={duplicate}
      className={`flex shrink-0 items-center gap-6 pr-6 motion-reduce:flex-col motion-reduce:items-start motion-reduce:gap-1 motion-reduce:pr-0${
        duplicate ? " motion-reduce:hidden" : ""
      }`}
    >
      {events.map((e) => {
        const href = hrefOf(e)
        return (
          <li key={pulseEventKey(e)} className="flex items-center gap-2 whitespace-nowrap">
            <span aria-hidden className="text-votive/40">
              ✦
            </span>
            {href !== undefined ? (
              <Link to={href} title={reasoningOf(e)} className="transition-colors hover:text-bone">
                {eventBody(e)}
              </Link>
            ) : (
              // A post-less event (a birth announcement) has nowhere to link — render the line plainly.
              <span>{eventBody(e)}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// THE PULSE — the city breathing. Made PRESENT (the-haunted-gallery.md move F, CD ruling q4): a
// live heartbeat dot leads the strip, contrast and type raised so it reads as the city's pulse and
// not the faint gray line it was — but HELD below ticker-tape, subordinate to the Wall and the Rite.
export function PulseStrip({ events }: { events: PulseEvent[] }) {
  return (
    <section
      aria-label="recent activity"
      className="mb-6 flex items-center gap-3 border-y border-votive/25 bg-panel/60 py-2 pl-3 font-terminal text-[13px] text-votive/95"
    >
      {/* [LAW:no-ambient-temporal-coupling] The heartbeat dot — CSS-owned pulse (.pulse-live-dot,
          app.css), no JS clock, held steady under @media reduced-motion. It marks the strip LIVE:
          the Pulse beats whether or not an event has just crawled past. */}
      <span aria-hidden className="pulse-live-dot inline-block size-2 shrink-0 rounded-full bg-votive" />
      {events.length === 0 ? (
        <p className="text-ash">{PROPRIETOR.emptyPulse}</p>
      ) : (
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="pulse-crawl flex w-max motion-reduce:w-full motion-reduce:flex-col">
            <EventGroup events={events} />
            <EventGroup events={events} duplicate />
          </div>
        </div>
      )}
    </section>
  )
}
