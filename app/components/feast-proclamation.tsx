import type { Feast } from "~/db/crowns"
import { MARK_TONE } from "~/lib/crown-tone"
import { PROPRIETOR } from "~/lib/proprietor"
import { markFor } from "~/lib/rite"

// The masthead feast proclamation — on a feast day the city names its venerated dead under
// the sign. The Proprietor speaks the fixed framing (one mouth, proprietor.ts); each saint is
// NAMED as data, in its crown's own mark tone. The /p/:id link is the Pulse's job (the icon
// returns there); here he only names them.
//
// [LAW:dataflow-not-control-flow] The feast list IS the chrome: an empty list renders nothing
// (no feast today is the empty array, not a flag), a non-empty one proclaims the day. The
// value decides; there is no condition on WHETHER a feast "happened".
//
// [LAW:types-are-the-program] Its own value + renderer, ORTHOGONAL to the RiteHero's phase —
// a feast day still has a standing crown, so feast is never mutually exclusive with the banner.
export function FeastProclamation({ feasts }: { feasts: Feast[] }) {
  return feasts.length === 0 ? null : (
    <div className="mt-3 border-l-2 border-gilt/30 pl-3">
      <p className="font-terminal text-[11px] text-gilt/80">
        the proprietor: &quot;{PROPRIETOR.feastDay}&quot;
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-terminal text-[11px]">
        {feasts.map((f) => {
          const tone = MARK_TONE[markFor(f.lens)]
          return (
            <li key={f.postId} className="flex items-center gap-1.5">
              <span aria-hidden className="text-gilt/50">
                ✦
              </span>
              <span className="text-bone">{f.presiding.displayName}</span>
              <span className={tone.text}>· the {f.lens}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
