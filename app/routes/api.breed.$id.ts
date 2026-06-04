import type { Route } from "./+types/api.breed.$id"
import { z } from "zod"
import { ApiError } from "@fal-ai/client"
import { createPost, InvalidParamsError } from "~/db/posts"
import { getPostById } from "~/db/feed"
import { breed } from "~/firehose/breed"
import { composePrompt } from "~/firehose/composer"
import { checkBudget } from "~/firehose/budget"
import { getProvider, realProviders, UnknownProviderError } from "~/providers"
import { resolveVoter } from "~/lib/voter-cookie"
import { isSameOrigin } from "~/lib/same-origin"
import { invalidBodyResponse } from "~/lib/api-errors"
import { authorLabel } from "~/lib/author-label"
import { PostId, type AuthoredOrigin, type Genome } from "~/lib/domain"

// [LAW:single-enforcer] The HTTP trust boundary for BREED submission — sexual (two-parent)
// reproduction, the Breeding Room's act. Sibling of api.fork.$id (single/asexual), NOT a mode on
// it: two distinct reproduction acts, two surfaces (the laws forbid bolting a second-parent toggle
// onto fork — that is mode-explosion). The /breed/:id page renders the room and POSTs here.
//
// Verification order mirrors fork: method → isSameOrigin (CSRF) → body parse (the MATE id; NO
// human prompt — mates not words, the product invariant holds) → load BOTH parents → assert both
// are generations and distinct → budget gate → voter → the 3-step assembly:
//   (1) breed(a, b, seed) folds genes/traits/lineage PURELY (crossover, no utterance);
//   (2) the ONE composer authors the child's utterance from the breed occasion (both parents'
//       utterances + the child's register); (3) createPost writes the bred 2-edge lineage.

const bodySchema = z.object({
  // The mate (parent B). Parent A is the URL :id — the slop carried in from the card doorway.
  // No prompt field by design: the breeder chooses the MATES, the composer authors the words.
  mateId: z.string().trim().min(1).max(128),
})

// [LAW:types-are-the-program] A breedable parent is an authored generation. Narrow both parents to
// that shape once, loudly: a generation with a non-authored origin is a storage-integrity violation
// (the reader pairs Content.kind ↔ Origin.kind), and a non-generation carries no genome to cross.
type BreedableParent = { id: PostId; genome: Genome; author: AuthoredOrigin["author"] }

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
    return invalidBodyResponse(e, `body must be { mateId: string } — the second parent; no prompt (mates, not words)`)
  }

  const env = context.cloudflare.env

  // Parent A is the doorway slop (URL); parent B is the mate the room found.
  if (parsed.mateId === params.id) {
    return Response.json({ error: "a slop cannot breed with itself", postId: params.id }, { status: 400 })
  }

  const breedable = async (id: string): Promise<BreedableParent | Response> => {
    const post = await getPostById(env, PostId(id))
    if (post === null) {
      return Response.json({ error: "parent post not found", postId: id }, { status: 404 })
    }
    if (post.content.kind !== "generation") {
      return Response.json({ error: "only generation posts can breed", postId: id }, { status: 400 })
    }
    if (post.origin.kind !== "authored") {
      throw new Error(`breedable generation ${post.id} has non-authored origin`)
    }
    return { id: PostId(id), genome: post.content.genome, author: post.origin.author }
  }

  const a = await breedable(params.id)
  if (a instanceof Response) return a
  const b = await breedable(parsed.mateId)
  if (b instanceof Response) return b

  // [LAW:single-enforcer] The same daily spend cap every paid entrypoint honors. After parent
  // validity so a malformed breed (404/400) cannot probe the spend state.
  let budget
  try {
    budget = await checkBudget(env)
  } catch {
    return Response.json({ error: "budget check unavailable" }, { status: 503 })
  }
  if (!budget.withinBudget) {
    return Response.json(
      { error: "daily budget exhausted", spentUsd: budget.spentUsd, ceilingUsd: budget.ceilingUsd },
      { status: 429 },
    )
  }

  // (1) The pure crossover fold — genes + traits + lineage bred[a,b], NO utterance. Fresh seed per
  // breed (reproducibility-by-default is the firehose's contract, not the human breeder's).
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]!
  const bred = breed(a.genome, b.genome, seed)

  // The child renders through the medium it inherited; the citizen who owns that medium is its
  // author (the doc's "out of A, by B"). Crossover gives the medium from exactly one parent — the
  // author is that parent (A on a same-medium tie). The OTHER parent lives in the bred lineage.
  const mediumFromA = bred.genes.medium === a.genome.genes.medium
  const author = mediumFromA ? a.author : b.author

  // [LAW:single-enforcer] Provider lookup through the one registry. The bred medium came from a
  // parent that rendered with it, but a legacy parent could carry a mock providerId the prod env
  // filters out — surface that loud (422) rather than rendering through an unavailable medium.
  let provider
  try {
    provider = getProvider(bred.genes.medium)
  } catch (e) {
    if (e instanceof UnknownProviderError) {
      return Response.json({ error: "bred medium not registered", providerId: bred.genes.medium }, { status: 404 })
    }
    throw e
  }
  if (!realProviders(env).some((p) => p.id === bred.genes.medium)) {
    return Response.json(
      { error: "bred medium not available in this environment", providerId: bred.genes.medium },
      { status: 422 },
    )
  }

  const voter = resolveVoter(request)

  try {
    // (2) The ONE composer authors the child's utterance from the breed occasion — both parents'
    // voices recombined, the child's register steering it. The human picked the mates; the machine
    // authors the words (the product invariant). The title is the child's own placard.
    const { prompt: utterance, title } = await composePrompt(
      {
        styleFamily: bred.genes.species,
        subject: bred.genes.form,
        aspectRatio: bred.genes.frame,
        traits: bred.traits,
        occasion: { kind: "breed", parents: [a.genome.utterance, b.genome.utterance] },
        maxLength: provider.promptMaxLength,
      },
      env,
    )

    const params_ = provider.defaultParamsForRecipe({
      prompt: utterance,
      styleFamily: bred.genes.species,
      seed,
    })

    // [LAW:types-are-the-program] The bred child is AUTHORED by the medium's citizen; the human who
    // bred it is the `breeder` MODIFIER, never the author. The raw voter UUID never crosses the
    // wire — authorLabel is the single redaction enforcer.
    const origin: AuthoredOrigin = {
      kind: "authored",
      author,
      human: { role: "breeder", by: { kind: "anon", label: authorLabel(voter.voterId) } },
    }

    // (3) The bred 2-edge write — createPost folds lineage.bred → two lineage_edges rows already.
    const post = await createPost(
      {
        kind: "generation",
        genes: bred.genes,
        utterance,
        traits: bred.traits,
        lineage: bred.lineage,
        params: params_,
        title,
        origin,
      },
      { env },
    )

    const headers = new Headers({ "content-type": "application/json" })
    if (voter.setCookieHeader !== null) headers.set("set-cookie", voter.setCookieHeader)
    return new Response(JSON.stringify({ id: post.id, parents: [a.id, b.id] }), { headers, status: 201 })
  } catch (e) {
    // [LAW:single-enforcer] Mirror api.fork / api.generate error mapping.
    if (e instanceof UnknownProviderError) {
      return Response.json({ error: "bred medium not registered", providerId: bred.genes.medium }, { status: 404 })
    }
    if (e instanceof InvalidParamsError) {
      return Response.json(
        { error: "invalid params for bred medium", providerId: bred.genes.medium, issues: e.issues },
        { status: 422 },
      )
    }
    if (e instanceof ApiError) {
      return Response.json(
        { error: "breed failed", providerId: bred.genes.medium, upstreamStatus: e.status, detail: e.body },
        { status: 502 },
      )
    }
    return Response.json(
      { error: "breed failed", providerId: bred.genes.medium, detail: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    )
  }
}
