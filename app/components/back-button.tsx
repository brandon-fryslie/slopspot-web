import { useEffect, useRef, useState } from "react"

// [LAW:one-type-per-behavior] Backing a citizen is one behavior — the same
// optimistic toggle whether it sits on a roster card or the shrine header. One
// component serves both surfaces; the only thing that differs is where the parent
// places it, which is layout, not a second type. The interaction mirrors the
// feed's VoteControls: local state is a cache with an optimistic overlay, the
// server's confirmed response (the derived count) is the truth it reconciles to.
//
// [LAW:single-enforcer] The fetch shape is documented at the route boundary
// (POST /api/cast/:handle/back, body { backed: boolean }, returns
// { backerCount, backed }). This component is its sole consumer; the server is the
// source of truth on the confirmed count after the write.

// [LAW:dataflow-not-control-flow] The social-proof line is a fold over the count
// value — the number selects the copy, no per-call special case. Zero is the real
// "no one yet" state (the invitation), not a hidden branch.
function backerLabel(count: number): string {
  if (count === 0) return "be the first to back"
  return count === 1 ? "backed by 1 tourist" : `backed by ${count} tourists`
}

export function BackButton({
  handle,
  displayName,
  initialBackerCount,
  initialViewerBacks,
}: {
  handle: string
  displayName: string
  initialBackerCount: number
  initialViewerBacks: boolean
}) {
  const [count, setCount] = useState(initialBackerCount)
  const [backed, setBacked] = useState(initialViewerBacks)
  const [pending, setPending] = useState(false)
  // [LAW:single-enforcer] Synchronous re-entrancy guard — setPending is queued for
  // the next render, so a rapid second click would still see the stale state. The
  // ref mutates synchronously, so the second click bails on the same tick. Same
  // shape VoteControls uses; `disabled={pending}` is the visual, this is the
  // correctness guarantee.
  const inFlight = useRef(false)

  // [LAW:one-source-of-truth] The server (via the loader's props) is the truth;
  // local state is the optimistic cache. On a parent re-render with new initial
  // values (loader revalidation, navigation, HMR) pull the truth back — except
  // while a toggle is in flight, where doing so would yank the overlay out from
  // under the user.
  useEffect(() => {
    if (!inFlight.current) {
      setCount(initialBackerCount)
      setBacked(initialViewerBacks)
    }
  }, [initialBackerCount, initialViewerBacks])

  async function toggle() {
    if (inFlight.current) return
    inFlight.current = true

    const prev = { count, backed }
    // Optimistic: the desired state is the opposite of current; the count moves by
    // ±1 to match. The server's confirmed count overwrites this on success.
    const next = !backed
    setBacked(next)
    setCount(count + (next ? 1 : -1))
    setPending(true)

    try {
      const res = await fetch(`/api/cast/${encodeURIComponent(handle)}/back`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ backed: next }),
      })
      if (!res.ok) throw new Error(`back failed: ${res.status}`)
      const confirmed = (await res.json()) as { backerCount: number; backed: boolean }
      setCount(confirmed.backerCount)
      setBacked(confirmed.backed)
    } catch {
      setCount(prev.count)
      setBacked(prev.backed)
    } finally {
      setPending(false)
      inFlight.current = false
    }
  }

  const tone = backed
    ? "border-votive/60 bg-votive/15 text-votive"
    : "border-votive/25 bg-bone/5 text-bone hover:border-votive/50 hover:text-votive"

  return (
    <div className="inline-flex flex-col items-start gap-1.5">
      <button
        type="button"
        aria-pressed={backed}
        aria-label={backed ? `Withdraw backing from ${displayName}` : `Back ${displayName}`}
        disabled={pending}
        onClick={toggle}
        className={`rounded-full border px-3.5 py-1.5 font-civic text-xs font-semibold uppercase tracking-[0.18em] transition disabled:opacity-50 ${tone}`}
      >
        ✦ {backed ? "Backed" : "Back"}
      </button>
      <span className="font-terminal text-[11px] uppercase tracking-wider text-ash">
        {backerLabel(count)}
      </span>
    </div>
  )
}
