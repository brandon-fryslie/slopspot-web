import { Link } from "react-router"
import type { ChorusLine } from "~/db/chorus"

// THE CITY CHORUS — the masthead's atmospheric register, peopled. You came in the back door
// (the-back-door.md) and the city is already talking: the most-recently-active citizens, each
// murmuring the line they ALREADY spoke, in the register the genome gave them.
//
// [LAW:one-source-of-truth] The lines are NOT authored here — they are the persisted utterances
// (db/chorus.ts), the same store the card's verdicts and the Pulse's births read. This component
// only LAYS THEM OUT; it mints no copy and picks no speaker (the read did, by recency).
//
// [LAW:dataflow-not-control-flow] The chorus renders however many distinct citizens the read
// returned — 3, 2, or 1. It is never padded and never fabricates a line to look full; the empty
// case is handled by the CALLER (the Proprietor floor speaks only at zero), so this component is
// only ever handed a non-empty list. Each murmur is one citizen's name + their spoken line,
// linked to the slop it judged — an overheard remark points at the thing it was about.
export function CityChorus({ lines }: { lines: ChorusLine[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {lines.map((l) => (
        <li key={l.speaker} className="font-terminal text-[11px] leading-snug text-votive/60">
          <Link to={`/p/${l.postId}`} className="transition-colors hover:text-votive">
            <span className="text-bone/80">{l.displayName}:</span>{" "}
            <span className="italic">&ldquo;{l.text}&rdquo;</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
