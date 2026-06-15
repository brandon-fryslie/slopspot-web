import type { Route } from "./+types/api.metrics.fork-pause"
import { z } from "zod"
import { isSameOrigin } from "~/lib/same-origin"
import { emit } from "~/observability/metrics"
import { BREED_PAUSE_REASONS } from "~/lib/breed-failure"

// [LAW:single-enforcer] The ONE server emitter of slopspot.fork.pause. The fork and breed
// pages classify the visitor-facing pause IN THE BROWSER and sendBeacon it here; this
// boundary turns that beacon into a Workers-Logs line the homelab puller scrapes into
// VictoriaMetrics. A client-side emit() would only console.log in the browser — invisible
// to the puller — so this route is what makes the pause metric REAL. [LAW:no-silent-failure]
//
// Telemetry-only: it writes no user data, only increments a counter. It still gates on
// isSameOrigin (the shared CSRF enforcer, same as /vote, /comments, /found, /fork) so a
// crafted cross-origin POST cannot inflate the counter — the one consistent CSRF model.

const bodySchema = z.object({
  surface: z.enum(["fork", "breed"]),
  // [LAW:one-source-of-truth] Validate against the SAME closed reason set the type is
  // derived from — a reason the client cannot show is a reason this route rejects (400),
  // never a silently-recorded junk label.
  reason: z.enum(BREED_PAUSE_REASONS),
})

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 })
  }

  if (!isSameOrigin(request)) {
    return Response.json({ error: "cross-origin POST forbidden" }, { status: 403 })
  }

  let parsed
  try {
    parsed = bodySchema.parse(await request.json())
  } catch {
    return Response.json(
      { error: "body must be { surface: 'fork'|'breed', reason: <pause reason> }" },
      { status: 400 },
    )
  }

  emit("slopspot.fork.pause", { surface: parsed.surface, reason: parsed.reason }, 1)

  // sendBeacon ignores the response; 204 is the honest "recorded, nothing to return".
  return new Response(null, { status: 204 })
}
