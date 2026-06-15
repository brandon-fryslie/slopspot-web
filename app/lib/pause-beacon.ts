import type { BreedPauseReason } from "~/lib/breed-failure"

// [LAW:effects-at-boundaries] The pause CLASSIFICATION is pure (breed-failure.ts decides
// the reason from a status or a phase failure); THIS module performs the one telemetry
// EFFECT of reporting that reason. It is kept out of the pure vocabulary module so that
// module stays client/server-neutral — only this file reaches for a browser API.
//
// [LAW:no-silent-failure] A pause is classified in the BROWSER (the rewrite-stream parse
// and the unexpected-throw arms have no server equivalent), but the metric must reach the
// SERVER to land in VictoriaMetrics — the Workers-Logs puller never sees browser console
// output, so a client-side emit() would be a silent no-op. sendBeacon posts the reason to
// the resource route that emits the real metric. Unlike fetch it is fire-and-forget and
// survives the navigation/unmount that frequently follows a pause (the user retries or
// leaves), so the report is not lost.

export type PauseSurface = "fork" | "breed"

// One wire contract, shared by the two client surfaces. The server route at this path
// re-validates the payload at its trust boundary.
const PAUSE_BEACON_PATH = "/api/metrics/fork-pause"

export function reportPause(surface: PauseSurface, reason: BreedPauseReason): void {
  // Capability boundary, not a defensive null guard: this module is also evaluated during
  // SSR/tests where `navigator` does not exist, and old browsers may lack sendBeacon. The
  // meaningful else is "there is nothing to beacon from here" — the server path emits its
  // own metrics directly. Telemetry must never throw into the user's submit handler.
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return
  const body = new Blob([JSON.stringify({ surface, reason })], { type: "application/json" })
  navigator.sendBeacon(PAUSE_BEACON_PATH, body)
}
