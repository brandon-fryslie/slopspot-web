import type { Route } from "./+types/api.fork.$id"
import { z } from "zod"
import { ApiError } from "@fal-ai/client"
import { createPost, InvalidParamsError } from "~/db/posts"
import { getPostById } from "~/db/feed"
import { checkBudget } from "~/firehose/budget"
import { getProvider, realProviders, UnknownProviderError } from "~/providers"
import { resolveVoter } from "~/lib/voter-cookie"
import { isSameOrigin } from "~/lib/same-origin"
import { invalidBodyResponse } from "~/lib/api-errors"
import { authorLabel } from "~/lib/author-label"
import { GenomeId, PostId, ProviderId, type AuthoredOrigin } from "~/lib/domain"
import { aspectRatioSchema, fallbackTitle, styleFamilySchema } from "~/lib/variety"
import { PROMPT_MAX } from "~/lib/fork-bounds"

// [LAW:single-enforcer] The HTTP trust boundary for fork submission. Resource
// route (no default export) — matching /api/posts/:id/vote and
// /api/posts/:id/comments. The page route at /fork/:id renders the form and
// POSTs here; it never embeds an action of its own (RR7's document-route CSRF
// gate requires x-forwarded-host alignment that the vite-plugin dev server
// does not set, and the same-origin defense already lives at this boundary).
//
// Verification order: method → isSameOrigin (CSRF, ~/lib/same-origin shared
// with vote + comments) → body parse (Zod) → parent lookup → assert parent is
// a generation → budget gate → voter id resolve → derive provider-native
// params via provider.defaultParamsForRecipe → delegate to createPost with
// parentId set.

const bodySchema = z.object({
  prompt: z.string().trim().min(1).max(PROMPT_MAX),
  styleFamily: styleFamilySchema,
  aspectRatio: aspectRatioSchema,
  // [LAW:single-enforcer] The registry's getProvider() enforces valid IDs; no
  // need to enumerate allowed values here. An unregistered providerId returns 404.
  providerId: z.string().trim().min(1).max(128),
})

export async function action({ request, params, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 })
  }

  if (!isSameOrigin(request)) {
    return Response.json({ error: "cross-origin POST forbidden" }, { status: 403 })
  }

  let parsed
  try {
    parsed = bodySchema.parse(await request.json())
  } catch (e) {
    return invalidBodyResponse(
      e,
      `body must be { prompt: string (1..${PROMPT_MAX} after trim), styleFamily, aspectRatio, providerId: string }`,
    )
  }

  const parent = await getPostById(context.cloudflare.env, PostId(params.id))
  if (parent === null) {
    return Response.json(
      { error: "parent post not found", postId: params.id },
      { status: 404 },
    )
  }
  if (parent.content.kind !== "generation") {
    // [LAW:types-are-the-program] Uploads carry no recipe. The PostCard Fork
    // button is gated on content.kind at compile time; this 400 defends
    // direct-URL access.
    return Response.json(
      { error: "only generation posts are forkable", postId: params.id },
      { status: 400 },
    )
  }

  // [LAW:single-enforcer] Same daily spend cap the /api/generate route honors.
  // A successful fork calls a real provider — the budget gate must apply at
  // every paid entrypoint, not just the agent-API one. Runs after parent-
  // validity checks so a malformed fork (404 / 400) doesn't get to probe the
  // spend state.
  let budget
  try {
    budget = await checkBudget(context.cloudflare.env)
  } catch {
    return Response.json({ error: "budget check unavailable" }, { status: 503 })
  }
  if (!budget.withinBudget) {
    return Response.json(
      {
        error: "daily budget exhausted",
        spentUsd: budget.spentUsd,
        ceilingUsd: budget.ceilingUsd,
      },
      { status: 429 },
    )
  }

  // [LAW:single-enforcer] Provider lookup happens here (and again inside
  // createPost) — both call the same registry, so the lookup is one source of
  // truth. The early call here is the seam where canonical recipe fields
  // (prompt, styleFamily, seed) become provider-native params via
  // defaultParamsForRecipe — the same translation the firehose chooser does.
  // The fork's chosen provider (parsed.providerId) may differ from the parent's.
  const chosenProviderId = ProviderId(parsed.providerId)
  // Existence check first: unknown ID → 404. Then env-filter check: registered
  // but not available here (e.g. mock in prod) → 422. Order matters — collapsing
  // both into 422 would make a typo'd ID indistinguishable from a filtered one.
  let provider
  try {
    provider = getProvider(chosenProviderId)
  } catch (e) {
    if (e instanceof UnknownProviderError) {
      return Response.json(
        {
          error: "provider not registered",
          providerId: parsed.providerId,
        },
        { status: 404 },
      )
    }
    throw e
  }
  // [LAW:single-enforcer] Same filter the loader applies to populate the
  // client-side selector: only real providers are available in prod. The UI
  // enforces this affordance-side; this check is the trust-boundary enforcement
  // so crafted requests can't bypass the filter and use mock providers in prod.
  const available = realProviders(context.cloudflare.env)
  if (!available.some((p) => p.id === chosenProviderId)) {
    return Response.json(
      { error: "provider not available in this environment", providerId: parsed.providerId },
      { status: 422 },
    )
  }

  // Fresh seed each fork — reproducibility-by-default is the firehose's
  // contract, not the user-fork's. A user who wants to re-fork the same recipe
  // gets a new generation each time, which matches the UX intent.
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]
  const derivedParams = provider.defaultParamsForRecipe({
    prompt: parsed.prompt,
    styleFamily: parsed.styleFamily,
    seed,
  })

  const voter = resolveVoter(request)

  // [LAW:types-are-the-program] A generation is reconstructed by the reader with an
  // authored origin (Content.kind↔Origin.kind pairing). TS can't see that cross-field
  // link, so we narrow; a generation with any other origin is a storage-integrity
  // violation and is surfaced loud, never laundered. Post-migration this never fires.
  if (parent.origin.kind !== "authored") {
    throw new Error(`forkable generation ${parent.id} has non-authored origin`)
  }

  // [LAW:types-are-the-program] A bred slop is AUTHORED by its bloodline's persona:
  // the fork INHERITS the parent's author (lineage, not house-assignment policy — that
  // seam is owned elsewhere). The human who bred it is the optional `breeder` MODIFIER,
  // never the author. The raw voter UUID never crosses the wire; authorLabel is the
  // single redaction enforcer, so the breeder byline is the same `anon-XXXXXX` shape.
  const origin: AuthoredOrigin = {
    kind: "authored",
    author: parent.origin.author,
    human: { role: "breeder", by: { kind: "anon", label: authorLabel(voter.voterId) } },
  }

  try {
    const post = await createPost(
      {
        kind: 'generation',
        // [LAW:types-are-the-program] A fork is a SINGLE (asexual) reproduction: one parent,
        // its genome inherited with variation. The body plan (form) and the continuous traits
        // are inherited from the parent genome; the visitor may vary species/frame/medium and
        // re-authors the utterance. lineage.parent is the parent genome (= its post id). The
        // 2-parent crossover (bred) is L2 — this path stays single.
        genes: {
          species: parsed.styleFamily,
          form: parent.content.genome.genes.form,
          frame: parsed.aspectRatio,
          medium: chosenProviderId,
        },
        utterance: parsed.prompt,
        traits: parent.content.genome.traits,
        lineage: { kind: 'single', parent: GenomeId(parent.id) },
        params: derivedParams,
        // [LAW:one-source-of-truth] A forked (single/asexual) slop has no Haiku naming step on
        // this path; it takes the deterministic placard from its inherited subject — the same
        // derivation the composer fallback and read boundary use. (Giving a fork its own
        // LLM-authored name is a future ticket; this path adds no second LLM call.)
        title: fallbackTitle(parent.content.genome.genes.form),
        origin,
      },
      { env: context.cloudflare.env },
    )

    const headers = new Headers({ "content-type": "application/json" })
    if (voter.setCookieHeader !== null) {
      headers.set("set-cookie", voter.setCookieHeader)
    }
    return new Response(
      JSON.stringify({ id: post.id, parentId: parent.id }),
      { headers, status: 201 },
    )
  } catch (e) {
    // [LAW:single-enforcer] Mirror /api/generate's error-mapping shape. The
    // pre-lookup above resolved the provider once, but createPost's internal
    // getProvider call runs again — a race during dev HMR (registry rebuilt
    // between the two calls) would surface UnknownProviderError from inside
    // createPost. Map it to the same 404 the pre-lookup uses rather than
    // letting it fall to the generic 502.
    if (e instanceof UnknownProviderError) {
      return Response.json(
        {
          error: "provider not registered",
          providerId: parsed.providerId,
        },
        { status: 404 },
      )
    }
    if (e instanceof InvalidParamsError) {
      return Response.json(
        {
          error: "invalid params for provider",
          providerId: parsed.providerId,
          issues: e.issues,
        },
        { status: 422 },
      )
    }
    if (e instanceof ApiError) {
      return Response.json(
        {
          error: "fork failed",
          providerId: parsed.providerId,
          upstreamStatus: e.status,
          detail: e.body,
        },
        { status: 502 },
      )
    }
    return Response.json(
      {
        error: "fork failed",
        providerId: parsed.providerId,
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    )
  }
}
