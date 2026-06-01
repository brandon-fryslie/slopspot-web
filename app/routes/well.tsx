import { useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router"
import { z } from "zod"
import { WISH_MAX } from "~/lib/well-response"

// The Wishing Well — the haunted prompt box (design-docs/the-wishing-well.md).
//
// [LAW:locality-or-seam] Page route only — a default export, no loader/action.
// The box is a static surface; submission POSTs to /api/well (the resource route
// that owns same-origin + budget + seating + authoring). A page route carrying an
// action triggers RR7's document-handler CSRF gate (needs x-forwarded-host the
// vite-plugin dev server omits); the same-origin defense already lives at the
// resource boundary, so the split is no regression — identical to /fork.
//
// THE MARK (Act I): the box presents as an ORDINARY wish tool. It discloses NOTHING
// about the spirit that will re-author the wish — the-slop.md §3, "we hide nothing,
// we explain nothing." The reveal DAWNS on the slop's card (a citizen's name atop
// "your" creation), never here. The only thing planted in plain sight is the faint
// sense that something is listening — the same in-plain-sight doubt the inverted
// credit plants, the engine of Act II. No copy here may name the mechanism.

// [LAW:one-source-of-truth] The box consumes /api/well's OPEN contract verbatim —
// the polymorphic WellResponse (slop | reply). The schema mirrors both arms so the
// channel is open end-to-end: v1's server only ever sends `slop`, but the box knows
// `reply` exists and is forced to consider it. When talk-back ships (Acts IV–V), the
// box renders the reply arm without a contract change — nothing here is walled off.
const wellResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("slop"), postId: z.string().min(1) }),
  z.object({ kind: z.literal("reply"), text: z.string() }),
])

export function meta() {
  return [
    { title: "The Wishing Well — SlopSpot" },
    { name: "description", content: "Make a wish." },
  ]
}

// [LAW:types-are-the-program] Two phases, not a boolean. "wishing" persists until
// the route changes (navigation away on a slop) or an error returns it to "idle".
type Phase = "idle" | "wishing"

export default function WellPage() {
  const navigate = useNavigate()
  const [wish, setWish] = useState("")
  const [phase, setPhase] = useState<Phase>("idle")
  const [error, setError] = useState<string | null>(null)

  // [LAW:single-enforcer] Synchronous re-entrancy guard + a single abort controller
  // — same shape as the fork page. Each wish fires a paid provider call, so a
  // double-submit inside one microtask (before setPhase flushes) would charge twice;
  // the ref bails on the same tick. Aborting on unmount cancels the in-flight Worker
  // request.
  const inFlight = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const wishing = phase === "wishing"

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (inFlight.current) return
    const text = wish.trim()
    if (text.length === 0) {
      setError("the well takes a wish, not silence")
      return
    }
    inFlight.current = true
    const abort = new AbortController()
    abortRef.current = abort
    setPhase("wishing")
    setError(null)

    try {
      const res = await fetch("/api/well", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wish: text }),
        signal: abort.signal,
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => "")
        throw new Error(`the well went quiet (${res.status}) ${detail}`.trim())
      }

      // [LAW:dataflow-not-control-flow] Switch on the arm, exhaustively — the
      // content of the response decides what happens, no flag. `slop` → the
      // permalink, where the gap between wish and result dawns. `reply` is the
      // reserved talk-back arm: v1's server never sends it, but the box must not
      // assume "always a slop" — when it arrives later this is where it renders.
      const parsed = wellResponseSchema.parse(await res.json())
      switch (parsed.kind) {
        case "slop":
          navigate(`/p/${parsed.postId}`)
          return
        case "reply":
          // Reserved (Acts IV–V): the spirit talked back. Not rendered as a
          // conversation in v1 — surfacing the line is the talk-back ticket's UI.
          setError(parsed.text)
          setPhase("idle")
          return
        default: {
          const _exhaustive: never = parsed
          throw new Error(`unhandled well response: ${JSON.stringify(_exhaustive)}`)
        }
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        setError(err instanceof Error ? err.message : String(err))
        setPhase("idle")
      }
    } finally {
      inFlight.current = false
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-4 py-12">
      <header className="mb-10">
        <Link
          to="/"
          className="font-terminal text-xs uppercase tracking-[0.25em] text-ash transition-colors hover:text-bone"
        >
          ← back to the floor
        </Link>
        <h1 className="mt-6 font-placard text-5xl font-bold leading-none tracking-tight text-bone">
          The Wishing Well
        </h1>
        {/* The Mark's only line: ordinary, atmospheric, non-disclosing. */}
        <p className="mt-4 font-civic text-sm leading-relaxed text-ash">
          Describe what you want. Toss it in. Something is always listening.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <textarea
          value={wish}
          onChange={(e) => setWish(e.target.value)}
          maxLength={WISH_MAX}
          rows={5}
          disabled={wishing}
          autoFocus
          placeholder="a lighthouse at the end of the world…"
          className="block w-full resize-y rounded-md border border-votive/15 bg-panel px-4 py-3 font-civic text-base leading-relaxed text-bone placeholder:text-ash/60 focus:border-votive/50 focus:outline-none disabled:opacity-50"
        />

        <div className="flex items-center justify-between">
          <span className="font-terminal text-[11px] text-ash">
            {wishing ? "the well is drawing something up…" : `${wish.trim().length}/${WISH_MAX}`}
          </span>
          <button
            type="submit"
            disabled={wishing || wish.trim().length === 0}
            className="rounded-md border border-votive/30 bg-votive/10 px-5 py-2 font-civic text-sm font-medium uppercase tracking-wider text-votive transition-colors hover:bg-votive/20 disabled:opacity-40"
          >
            {wishing ? "Wishing…" : "Make a wish"}
          </button>
        </div>

        {error !== null && (
          <p className="rounded-md border border-profane/30 bg-profane/5 px-4 py-2 font-terminal text-[12px] text-profane">
            {error}
          </p>
        )}
      </form>
    </main>
  )
}
