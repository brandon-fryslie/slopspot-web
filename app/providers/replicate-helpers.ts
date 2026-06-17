import { z } from "zod"
import type { AspectRatio } from "~/lib/domain"
import { healthFromHttpStatus, reportAccountHealth } from "~/observability/account-health"

// Shared trust-boundary code for the Replicate prediction API. Replicate's
// `/v1/predictions` envelope is identical for every model — only `output`'s
// shape varies per model. The envelope schema, the polling loop, and the
// create-with-Prefer-wait call live here so each Replicate-based provider
// parses the wrapper the same way and only owns the parse of `output`.
//
// [LAW:one-source-of-truth] One Replicate envelope shape, one place it's
// declared. SDXL returns `output: string[]`, Ideogram returns `output: string`
// — that genuine variance stays in each provider's own response parser.

// [LAW:one-source-of-truth] Canonical (w,h) per AspectRatio for Replicate-family
// providers. SDXL consumes these as the explicit `width`/`height` it sends to
// the Replicate API (SDXL's input requires explicit dims); Ideogram consumes
// them as the nominal dims it records in `Media.w/h` (Ideogram's API doesn't
// echo dims in the response, and its `aspect_ratio` enum picks an internal
// resolution we don't control). One table, two consumers — two providers
// cannot diverge on "what does ratio X mean in pixels" because there is no
// second copy to drift from. Values are from `design-docs/variety.md`
// §Aspect ratio policy.
export const REPLICATE_CANONICAL_DIMS: Record<AspectRatio, { w: number; h: number }> = {
  "1:1": { w: 1024, h: 1024 },
  "16:9": { w: 1344, h: 768 },
  "9:16": { w: 768, h: 1344 },
  "4:3": { w: 1152, h: 896 },
  "3:4": { w: 896, h: 1152 },
}

const PREDICTION_STATUSES = ['starting', 'processing', 'succeeded', 'failed', 'canceled'] as const

export const predictionSchema = z.object({
  id: z.string(),
  status: z.enum(PREDICTION_STATUSES),
  output: z.unknown().nullable(),
  error: z.unknown().nullable().optional(),
  urls: z.object({ get: z.string().url() }).optional(),
})
export type Prediction = z.infer<typeof predictionSchema>

// [LAW:types-are-the-program] Carry the HTTP status ON the thrown value (mirrors haiku.ts'
// AnthropicHttpError) so the account-health classifier reads the reason from DATA, not by
// re-parsing a message string. `phase` localizes WHICH Replicate call failed (the create POST
// or a poll GET) without the caller string-matching the message.
export class ReplicateHttpError extends Error {
  constructor(
    readonly status: number,
    readonly phase: 'create' | 'poll',
    body: string,
  ) {
    super(`Replicate ${phase} failed: ${status} ${body}`)
    this.name = 'ReplicateHttpError'
  }
}

const REPLICATE_PREDICTIONS_URL = 'https://api.replicate.com/v1/predictions'
const POLL_INTERVAL_MS = 2000
// Server-side wait via Prefer: wait=60 covers the common case (most Replicate
// models terminate in 5-30s). Fallback polling covers the long tail. Budget is
// generous because cron handlers have ~30s CPU but minutes of wall-clock for
// awaited fetch.
const MAX_POLLS = 30

// [LAW:single-enforcer] One create-with-Prefer-wait site. Each Replicate
// provider passes its pinned version + provider-native input; the helper owns
// headers, the Prefer:wait=60 contract, and envelope parsing. Posts to
// `/v1/predictions` (not `/v1/models/{owner}/{name}/predictions`) because the
// auto-latest endpoint is restricted to "official models" and 404s for
// community-hosted models — pinning the version hash is the contract.
//
// [LAW:single-enforcer] This helper is the Replicate transport leaf both replicate-* providers
// flow through, so the Replicate account's health is reported HERE — both providers are covered by
// construction, zero per-provider code. A 2xx on this auth-bearing create is the recovery signal
// (the same token feeds the poll, so an ok here means the credential works); a non-2xx classifies
// the down/degraded reason from the status. [LAW:dataflow-not-control-flow] health is reported on
// both arms; the data decides. A prediction that later reaches status='failed' is a GENERATION
// failure with the account healthy (every HTTP call was 2xx) — not an account-health concern.
export async function createPrediction(opts: {
  version: string
  input: Record<string, unknown>
  token: string
}): Promise<Prediction> {
  const res = await fetch(REPLICATE_PREDICTIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=60',
    },
    body: JSON.stringify({ version: opts.version, input: opts.input }),
  })
  if (!res.ok) {
    const body = await res.text()
    reportAccountHealth('replicate', healthFromHttpStatus(res.status))
    throw new ReplicateHttpError(res.status, 'create', body)
  }
  reportAccountHealth('replicate', { status: 'ok' })
  return predictionSchema.parse(await res.json())
}

export async function pollPrediction(prediction: Prediction, token: string): Promise<Prediction> {
  let current = prediction
  let polls = 0
  while (current.status === 'starting' || current.status === 'processing') {
    if (polls >= MAX_POLLS) {
      throw new Error(
        `Replicate prediction ${current.id} did not terminate within ${MAX_POLLS * POLL_INTERVAL_MS}ms of polling`,
      )
    }
    if (!current.urls?.get) {
      throw new Error(`Replicate prediction ${current.id} missing urls.get for polling`)
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const res = await fetch(current.urls.get, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const body = await res.text()
      reportAccountHealth('replicate', healthFromHttpStatus(res.status))
      throw new ReplicateHttpError(res.status, 'poll', body)
    }
    current = predictionSchema.parse(await res.json())
    polls += 1
  }
  return current
}
