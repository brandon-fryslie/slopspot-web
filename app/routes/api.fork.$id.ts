import type { Route } from "./+types/api.fork.$id"
import { z } from "zod"
import { ApiError } from "@fal-ai/client"
import { createPost, InvalidParamsError } from "~/db/posts"
import { getPostById } from "~/db/feed"
import { checkBudget } from "~/firehose/budget"
import { getProvider, realProviders, UnknownProviderError } from "~/providers"
import { getPersonaByMedium } from "~/agents/persona"
import { resolveVoter } from "~/lib/voter-cookie"
import { isSameOrigin } from "~/lib/same-origin"
import { invalidBodyResponse } from "~/lib/api-errors"
import { forkFailed, forkSucceeded } from "~/observability/fork-outcome"
import { authorLabel } from "~/lib/author-label"
import { GenomeId, PostId, ProviderId, type AuthoredOrigin, type PersonaActor } from "~/lib/domain"
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
    return forkFailed("fork", "parent-not-found", "parent post not found", { postId: params.id })
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
    return forkFailed("fork", "budget-unavailable", "budget check unavailable")
  }
  if (!budget.withinBudget) {
    return forkFailed("fork", "budget-exhausted", "daily budget exhausted", {
      spentUsd: budget.spentUsd,
      ceilingUsd: budget.ceilingUsd,
    })
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
      return forkFailed("fork", "provider-not-registered", "provider not registered", {
        providerId: parsed.providerId,
      })
    }
    throw e
  }
  // [LAW:single-enforcer] Same filter the loader applies to populate the
  // client-side selector: only real providers are available in prod. The UI
  // enforces this affordance-side; this check is the trust-boundary enforcement
  // so crafted requests can't bypass the filter and use mock providers in prod.
  const available = realProviders(context.cloudflare.env)
  if (!available.some((p) => p.id === chosenProviderId)) {
    return forkFailed(
      "fork",
      "provider-unavailable",
      "provider not available in this environment",
      { providerId: parsed.providerId },
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
    // [LAW:dataflow-not-control-flow] A user fork re-derives a recipe from an existing
    // post; it is NOT a Well wish, so it carries no embalmed-relic intent (the Fork-
    // rewrite muse is a separate concern, slopspot-wishing-well-97o.1). No embalm-negative
    // steering applies here.
    embalmedRelic: false,
  })

  const voter = resolveVoter(request)

  // [LAW:types-are-the-program] A generation is reconstructed by the reader with an
  // authored origin (Content.kind↔Origin.kind pairing). TS can't see that cross-field
  // link, so we narrow; a generation with any other origin is a storage-integrity
  // violation and is surfaced loud, never laundered. Post-migration this never fires.
  if (parent.origin.kind !== "authored") {
    throw new Error(`forkable generation ${parent.id} has non-authored origin`)
  }

  // [RECONCILE C] Interspecies detection: when the chosen provider is a different
  // citizen's medium than the parent's author, the crossing is recorded. The crossing
  // persona becomes the new `author` (they shaped the result); the parent's author
  // becomes `crossedFrom` (the lineage). For same-citizen breeds and provider-less
  // selections (mock providers), the author is simply inherited from the parent.
  const crossingPersona = await getPersonaByMedium(context.cloudflare.env, chosenProviderId)
  const isInterspecies =
    crossingPersona !== null && crossingPersona.agentId !== parent.origin.author.agentId

  const author: PersonaActor = isInterspecies
    ? { kind: "agent", agentId: crossingPersona.agentId }
    : parent.origin.author

  const origin: AuthoredOrigin = {
    kind: "authored",
    author,
    ...(isInterspecies
      ? { crossedFrom: { kind: "agent", agentId: parent.origin.author.agentId } }
      : {}),
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
    return forkSucceeded(
      "fork",
      new Response(
        JSON.stringify({ id: post.id, parentId: parent.id }),
        { headers, status: 201 },
      ),
    )
  } catch (e) {
    // [LAW:single-enforcer] Mirror /api/generate's error-mapping shape. The
    // pre-lookup above resolved the provider once, but createPost's internal
    // getProvider call runs again — a race during dev HMR (registry rebuilt
    // between the two calls) would surface UnknownProviderError from inside
    // createPost. Map it to the same provider-not-registered cause the pre-lookup
    // uses rather than letting it fall through to the generic `internal` fault.
    if (e instanceof UnknownProviderError) {
      return forkFailed("fork", "provider-not-registered", "provider not registered", {
        providerId: parsed.providerId,
      })
    }
    if (e instanceof InvalidParamsError) {
      return forkFailed("fork", "invalid-params", "invalid params for provider", {
        providerId: parsed.providerId,
        issues: e.issues,
      })
    }
    if (e instanceof ApiError) {
      // [LAW:no-silent-failure] The provider call reached upstream and FAILED there —
      // transient. Distinct cause (and status 502) from the generic catch below, so the
      // visitor's "try again" advice is only given when retrying can actually help.
      return forkFailed("fork", "provider-upstream", "fork failed", {
        providerId: parsed.providerId,
        upstreamStatus: e.status,
        detail: e.body,
      })
    }
    // [LAW:no-silent-failure] Any OTHER throw is a deterministic server-side fault (a bug, an
    // R2 write failure, a D1 failure inside createPost) — NOT a transient provider hiccup.
    // It gets the `internal` cause (status 500), so the visitor is told the fault is ours and
    // logged, never the misleading "the forge hit a snag; try again" the old shared 502 gave.
    return forkFailed("fork", "internal", "fork failed", {
      providerId: parsed.providerId,
      detail: e instanceof Error ? e.message : String(e),
    })
  }
}
