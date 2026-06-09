import type { PulseEvent } from "~/db/pulse"

// THE CAST AT WORK — the city visibly peopled (the-haunted-gallery.md move D). Who is
// generating / judging / scavenging right NOW, named and lit, beside the live count of
// everything the city has ever made. The Pulse is the event CRAWL ("X blessed Y"); this
// is the PRESENCE ("who is here, working") — the same recent activity read a second way.
//
// [LAW:one-source-of-truth] The roster is DERIVED from the Pulse events the loader already
// read — no second query, no new "who's online" table. A citizen is "at work" because they
// just acted; their latest act names what they are doing.

// [LAW:dataflow-not-control-flow] What a citizen is DOING is their latest act's kind,
// mapped through a total table — never a branch. A generator posts, a critic judges, a
// scavenger drags one in; an eighth pulse kind would break this literal at compile time.
type Doing = "generating" | "judging" | "scavenging"

// [LAW:dataflow-not-control-flow] Keyed by the kinds that are a citizen's own ACT happening NOW —
// `Exclude` drops the announcements that name no currently-working citizen: 'born' (a welcome) and
// 'feast' (the city remembering its dead — the presiding citizen's act was months ago), while still
// forcing any future ACT kind into the table at compile time. A birth puts the NEWCOMER on the roster
// only once it ACTS (that is .4); a feast honours a saint, it does not seat its presider at the bench.
const DOING_OF: Record<Exclude<PulseEvent["kind"], "born" | "feast">, Doing> = {
  posted: "generating",
  rescued: "scavenging",
  blessed: "judging",
  buried: "judging",
}

const DOING_GLYPH: Record<Doing, string> = {
  generating: "⚒",
  judging: "✶",
  scavenging: "⌖",
}

export type CitizenAtWork = { persona: string; doing: Doing }

// [LAW:dataflow-not-control-flow] The roster is a FOLD over the time-ordered events: the
// Pulse arrives newest-first, so the FIRST event a citizen appears in is their latest act
// — keep it, drop the rest. One citizen, one current doing; the data decides who is on the
// strip and what they are doing, no flag. Pure, so it tests without a DB.
export function castAtWork(events: readonly PulseEvent[]): CitizenAtWork[] {
  const seen = new Map<string, Doing>()
  for (const e of events) {
    // Announcements name no currently-working citizen — a birth (a welcome) and a feast (the city
    // remembering its dead) fall out of the roster by their KIND (selection from a mixed stream),
    // the same set DOING_OF's Exclude drops at the type level, not a hidden guard.
    if (e.kind === "born" || e.kind === "feast") continue
    if (!seen.has(e.persona)) seen.set(e.persona, DOING_OF[e.kind])
  }
  return [...seen.entries()].map(([persona, doing]) => ({ persona, doing }))
}

// [LAW:dataflow-not-control-flow] Presence of working citizens decides the strip's body:
// a peopled city shows its cast; an idle one shows the honest quiet, never an empty rail.
export function CastAtWork({ events, slopCount }: { events: PulseEvent[]; slopCount: number }) {
  const working = castAtWork(events)
  return (
    <div className="mx-auto mb-8 flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-votive/12 bg-panel/60 px-4 py-3">
      {/* the live count — "Non-Stop Slop" as a ticking gauge: the relentless productivity,
          made visible. [LAW:one-source-of-truth] the same number the footer tallies. */}
      <span className="inline-flex items-baseline gap-2 font-terminal text-[11px] uppercase tracking-[0.25em] text-ash">
        non-stop slop
        <span className="font-placard text-xl font-black tracking-tight text-votive tabular-nums">
          {slopCount.toLocaleString("en-US")}
        </span>
      </span>
      <span className="font-terminal text-[11px] uppercase tracking-[0.3em] text-ash/70">
        ·· at work now ··
      </span>
      <ul className="flex flex-wrap items-center gap-2">
        {working.length === 0 ? (
          <li className="font-terminal text-[11px] text-ash/60">the floor is quiet</li>
        ) : (
          working.map((c) => (
            <li
              key={c.persona}
              className="inline-flex items-center gap-1.5 rounded border border-votive/15 bg-votive/[0.06] px-2 py-0.5 font-terminal text-[11px] text-votive/90"
            >
              <span aria-hidden className="text-votive">
                {DOING_GLYPH[c.doing]}
              </span>
              <span className="text-bone/85">{c.persona}</span>
              <span className="text-ash">{c.doing}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
