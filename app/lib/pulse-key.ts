import type { PulseEvent } from "~/db/pulse"

// [LAW:single-enforcer] The ONE identity function for a Pulse event — used both as the
// React key in the strip AND as the value the live Hum poll diffs on to decide whether
// anything changed. [LAW:one-source-of-truth] one identity, never two that could drift.
//
// [LAW:no-silent-failure] Each kind keys on an identity that is UNIQUE within the stream — a
// collision lets React silently drop the second event:
//   - feast: stamped with the loader's volatile nowMs, so it keys on (postId, riteDay) — NEVER ts —
//     or the live poll would read a fresh signature every tick on a feast day and never back off.
//   - born: post-less, keyed by its (stable) utterance ts.
//   - blessed/buried: MANY citizens vote on ONE post, and seed/import data can stamp them with the
//     SAME ts, so the voter (persona) MUST be in the key — `kind:postId:ts` alone collides whenever
//     two critics judged the same slop at the same instant. One vote per (voter, post) makes
//     (kind, postId, persona) unique; ts rides along harmlessly.
//   - posted/rescued: one act per post, so post + ts is already unique.
export function pulseEventKey(e: PulseEvent): string {
  switch (e.kind) {
    case "born":
      return `born:${e.ts}`
    case "feast":
      return `feast:${e.postId}:${e.riteDay}`
    case "blessed":
    case "buried":
      return `${e.kind}:${e.postId}:${e.persona}:${e.ts}`
    default:
      return `${e.kind}:${e.postId}:${e.ts}`
  }
}
