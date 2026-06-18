// [LAW:single-enforcer] `authorSlop` is the one place a persona authors a slop:
// recipe choice → composition → provider params → createPost → the signed remark.
// Both entrypoints route through it — the firehose (`runGeneratorPass`, picking a
// persona by scheduled time) and the Well (`/api/well`, seating a persona to answer
// a wish). [LAW:one-type-per-behavior] authoring a slop is ONE behavior; the only
// difference between the two paths is DATA — a human wish + wisher modifier the Well
// carries and the firehose does not — so it is an optional `occasion` value, never a
// second pipeline. (foundation.5/.8: wire the existing seam, do not parallel it.)
//
// [LAW:dataflow-not-control-flow] Persona biases are multipliers forwarded to
// chooseNextGeneration as PersonaBias. Absent keys default to all-ones in every
// weight function — same code path every fire, no branch around the chooser body.
//
// [RECONCILE A] Every slop is authored by a persona, always. There is no
// system-agent fallback that authors as a non-citizen: an empty generator pool
// is a misconfiguration, not a silent default. [RECONCILE C] The provider is the
// persona's MEDIUM (config.medium), resolved here — never picked by the chooser.
//
// [LAW:types-are-the-program] GeneratorPersonaConfig is the typed projection of
// the persona's config_json blob for role='generator'. Parsed at the trust
// boundary (authorSlop); callers pass the raw Persona from pickPersona/seatCitizen.

import { z } from 'zod'
import {
  PostId,
  ProviderId,
  type AuthoredOrigin,
  type Genome,
  type HumanModifier,
  type HumanRef,
  type Post,
} from '~/lib/domain'
import { createPost } from '~/db/posts'
import { getRecentRecipes, type RecentRecipe } from '~/db/recent'
import { getNicheGenePool } from '~/db/genepool'
import { getPostById } from '~/db/feed'
import { recordRemark } from '~/db/remark'
import { recordUtterance } from '~/db/utterances'
import { pickPersona, type Persona } from '~/agents/persona'
import { breed } from '~/firehose/breed'
import { chooseNextGeneration } from '~/firehose/chooseNextGeneration'
import { dominantFamily, monoculturePressure } from '~/firehose/drift-floor'
import { composePrompt, type ComposerOccasion } from '~/firehose/composer'
import { pickNiche } from '~/firehose/niche'
import { selectReproduction, type ReproductionPlan } from '~/firehose/select'
import { seedHash } from '~/lib/hash'
import { pickWeighted } from '~/lib/weighted'
import { founderTraits } from '~/lib/founder-traits'
import { utter, type PersonaRef } from '~/lib/voice'
import { emit } from '~/observability/metrics'
import { ASPECT_RATIOS, STYLE_FAMILIES, type AspectRatio, type StyleFamily } from '~/lib/variety'
import { getProvider, mediumOf, realProviders } from '~/providers'

const RECENT_WINDOW = 20

// [LAW:types-are-the-program] .strict() on the bias schemas: unknown keys
// (non-canonical StyleFamily/AspectRatio values, or config typos) are a loud
// parse error at the trust boundary rather than silently stripped no-ops that
// produce a persona that does nothing. parseGeneratorConfig throws, so a bad
// row is caught on first fire rather than leaving a silently-neutered persona.
const styleFamilyBiasSchema = z
  .object(Object.fromEntries(STYLE_FAMILIES.map((s) => [s, z.number().positive().optional()])))
  .partial()
  .strict()
  .optional()

const aspectRatioBiasSchema = z
  .object(Object.fromEntries(ASPECT_RATIOS.map((a) => [a, z.number().positive().optional()])))
  .partial()
  .strict()
  .optional()

// [RECONCILE C] `medium` is the provider this citizen works in — required. The
// firehose derives the slop's provider from it; the chooser never picks one.
// Validated against the registry below (getProvider throws on an unknown id), so
// a typo'd medium fails loud on first fire, not as a silent wrong-provider post.
const generatorPersonaConfigSchema = z.object({
  medium: z.string(),
  styleFamilyBias: styleFamilyBiasSchema,
  aspectRatioBias: aspectRatioBiasSchema,
  promptPrefix: z.string().optional(),
  // The citizen's authored CREED (a Cast display asset, read by creedOf). The
  // generator does not consume it, but .strict() would reject the key migration
  // 0021 writes onto the maker configs — so it is admitted here explicitly.
  creed: z.string().optional(),
  // The citizen's self-portrait reference (roll-call-47p.6), written by the
  // portrait pass onto this same config. The generator does not consume it, but
  // .strict() would otherwise reject the key on the FIRST fire after a portrait
  // renders — coupling the maker's slops to its face. Admitted as `unknown` (not
  // the precise portrait shape) ON PURPOSE: lib/portrait owns the soft parse, so a
  // malformed portrait degrades the FRAME to a placeholder and never fails-loud the
  // firehose. [LAW:locality-or-seam] the portrait cannot break slop generation.
  portrait: z.unknown().optional(),
}).strict()

export type GeneratorPersonaConfig = z.infer<typeof generatorPersonaConfigSchema>

// Exported as the named trust boundary for generator config_json so its parse
// contract can be locked by a unit test over the actual seeded rows — asserting
// the real schema, not a reconstructed copy. [LAW:one-source-of-truth]
export function parseGeneratorConfig(raw: Record<string, unknown>, agentId: string): GeneratorPersonaConfig {
  const result = generatorPersonaConfigSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(
      `generator persona ${agentId}: config_json failed validation — ${result.error.message}`,
    )
  }
  return result.data
}

// [LAW:types-are-the-program] What occasioned a slop beyond the bare firehose. A
// closed union over the three authoring modes, NOT a bag of independent optionals:
//   absent          → the firehose (a citizen fires on its own; depict the recipe)
//   'wish'          → the Well (a human's wish, re-authored by the seated citizen)
//   'self-portrait' → the Cast portrait (the citizen depicts ITSELF, its own medium)
// The union makes the illegal both-at-once state — a wish that is also a
// self-portrait — UNREPRESENTABLE, which two separate optional params could not.
// The `wish` arm carries the visitor's words (trimmed at the wire boundary, never
// REWRITTEN): it steers composition and is NEVER sent raw to the provider
// (composer.ts owns that isolation); the wisher is the human MODIFIER on the
// persona's authorship, never the author. The `self-portrait` arm carries no human
// — the house's drift schedule occasioned it — so it adds no wisher, no provenance,
// no remark; only the composer's depiction changes. [LAW:dataflow-not-control-flow]
export type AuthoringOccasion =
  | { readonly kind: 'wish'; readonly wish: string; readonly wisher: HumanRef }
  | { readonly kind: 'self-portrait' }

// [LAW:one-source-of-truth] Project the authoring occasion onto the composer's
// narrower one — the composer steers on the wish words / the depicted citizen, never
// the wisher. The self-portrait arm injects the persona's own name (the authoring
// occasion does not carry it; the persona does). Exhaustive over the union: a new
// authoring mode forces a decision here before it compiles, so the composer can
// never silently receive the wrong occasion. [LAW:types-are-the-program]
function composerOccasionOf(
  occasion: AuthoringOccasion | undefined,
  displayName: string,
): ComposerOccasion | undefined {
  if (occasion === undefined) return undefined
  switch (occasion.kind) {
    case 'wish':
      return { kind: 'wish', wish: occasion.wish }
    case 'self-portrait':
      return { kind: 'self-portrait', displayName }
    default: {
      const _exhaustive: never = occasion
      return _exhaustive
    }
  }
}

// [LAW:single-enforcer] The one implementation that authors a slop as a given
// persona. The persona is the function's precondition (the caller seats/picks it);
// authorSlop owns everything downstream — config parse, medium resolution, recipe
// choice, composition, params, the write, and the signed remark.
//
// [RECONCILE A] A slop is authored by a persona, always. [RECONCILE C] The provider
// IS the persona's medium. The `occasion` (a human wish) only adds DATA: it seeds the
// composer, attaches the wisher as the human modifier, and produces the remark — it
// never forks the pipeline. `recipeSeedMs` is the chooser's RNG seed: the firehose
// passes its scheduled time (reproducible fires); the Well passes the request clock.
//
// Throws on any I/O or creation failure; the caller owns error handling + metrics.
export async function authorSlop(
  env: Env,
  persona: Persona,
  recipeSeedMs: number,
  occasion?: AuthoringOccasion,
): Promise<Post> {
  const recent = await getRecentRecipes(env, RECENT_WINDOW)
  const config = parseGeneratorConfig(persona.config, persona.agentId)

  // [RECONCILE C] The provider IS the author-persona's medium. getProvider
  // throws UnknownProviderError on a bad medium, so a misconfigured row fails
  // loud here rather than producing a wrong-provider slop.
  const provider = getProvider(ProviderId(config.medium))

  // [LAW:single-enforcer] Preserve the prod discipline the old realProviders(env)
  // filter enforced: a mock medium in prod is a misconfiguration, not a free fire.
  // Fail loud rather than author a mock slop on the live site. (Dev keeps mocks for
  // free local fires.)
  if (env.SLOPSPOT_ENV === 'prod' && provider.kind === 'mock') {
    throw new Error(
      `authorSlop: persona ${persona.agentId} has mock medium ${provider.id} in prod`,
    )
  }

  // [RECONCILE C] bias carries only the dimensions the chooser samples. The
  // persona's voice steers composition, so it flows straight to composePrompt
  // below — not through the chooser.
  const bias = {
    styleFamilyBias: config.styleFamilyBias as Partial<Record<StyleFamily, number>> | undefined,
    aspectRatioBias: config.aspectRatioBias as Partial<Record<AspectRatio, number>> | undefined,
  }

  const recipe = chooseNextGeneration({ scheduledTimeMs: recipeSeedMs, recent, provider, bias })

  // [LAW:single-enforcer] A FOUNDER is born with a VARIED trait vector, not flat neutral — the one
  // place the firehose's spontaneous bloodline gets its register (slopspot-genome-fby). Sampled ONCE
  // here and threaded into BOTH the composer (steer) and the genome (heritable code) below, so the
  // composed slop and the stored genome can never disagree about who this founder is.
  // [LAW:one-source-of-truth] The center is the author-citizen's OWN sensibility (persona.traits) —
  // a tuned citizen pulls its region of trait-space, a neutral one scatters around neutral; either
  // way the births SPREAD instead of clustering at the 0.5 mean that made the feed one voice.
  // [LAW:no-ambient-temporal-coupling] Seeded off recipeSeedMs (the firehose's scheduledTime; the
  // Well's request clock) — same fire, same founder. No ambient clock, no Math.random.
  const traits = founderTraits(persona.traits, recipeSeedMs)

  // [LAW:single-enforcer] composePrompt is the one place a slop's authored text is
  // generated from a recipe — both the machine prompt AND the citizen's placard
  // NAME, in one Haiku call. promptPrefix (the persona's voice) steers both;
  // maxLength flows from the provider's declared constraint so paramsSchema
  // validation never rejects a too-long prompt. The wish (Well only) seeds the SAME
  // composer — it never becomes the raw prompt; composer.ts owns that isolation.
  const { prompt, title } = await composePrompt(
    {
      styleFamily: recipe.styleFamily,
      subject: recipe.subject,
      aspectRatio: recipe.aspectRatio,
      // [LAW:one-source-of-truth] The SAME founder traits written to the genome below steer the
      // composition — a founder is now born SCATTERED around its citizen's register (founderTraits),
      // so traitBias projects a real steer instead of the empty one flat neutral used to produce.
      // Breeding (L2 surface) and selection (L3) pass recombined/drifted traits here.
      traits,
      promptPrefix: config.promptPrefix,
      // The occasion (a wish, a self-portrait, or none) flows as one closed value —
      // the composer cannot receive both a wish and a self-portrait by construction.
      occasion: composerOccasionOf(occasion, persona.displayName),
      maxLength: provider.promptMaxLength,
      // [LAW:single-enforcer] The medium the provider PRODUCES selects what Haiku is
      // asked to compose — an image-prompt or a poem. Derived from capabilities so the
      // provider is the single declaration site; no second medium field elsewhere.
      medium: mediumOf(provider),
    },
    env,
  )
  const params = provider.defaultParamsForRecipe({
    prompt,
    styleFamily: recipe.styleFamily,
    seed: recipe.paramsSeed,
    // [LAW:one-source-of-truth] A WISH occasion IS an embalmed-relic draw (the muse
    // doctrine embalms every Well wish). Derived from the SAME `occasion?.kind === 'wish'`
    // predicate this function already uses for the wisher modifier, the persisted wish, and
    // the remark — so all wish-scoped behaviors read one condition and cannot drift. A
    // supporting provider (sdxl/ideogram) then steers its render away from the round-10
    // failures (slopspot-render-fidelity-v2l); the firehose/self-portrait draw passes false
    // and renders living subjects unhindered. [LAW:dataflow-not-control-flow]
    embalmedRelic: occasion?.kind === 'wish',
  })

  // [LAW:types-are-the-program] The author is the persona, always. The human, when
  // an occasion exists, is the optional `wisher` MODIFIER — never promoted to author
  // ("a human in the author slot" stays unrepresentable). The conditional spread is
  // data-shaped construction (one origin shape, an optional field), not a branch
  // into a different origin. [LAW:dataflow-not-control-flow]
  const origin: AuthoredOrigin = {
    kind: 'authored',
    author: { kind: 'agent', agentId: persona.agentId },
    ...(occasion?.kind === 'wish'
      ? { human: { role: 'wisher', by: occasion.wisher } satisfies HumanModifier }
      : {}),
  }

  const post = await createPost(
    {
      kind: 'generation',
      // [LAW:types-are-the-program] The chooser's recipe fields ARE the genome's genes; the
      // composed prompt is its utterance. A firehose fire SPONTANEOUSLY seeds a new bloodline,
      // so its lineage is `founder`. Traits are sampled VARIED around the citizen's register
      // (founderTraits) — birth-spread breaking the monoculture; breeding (L2) and selection (L3)
      // then recombine/drift from a gene pool that no longer starts pinned to the 0.5 mean.
      genes: {
        species: recipe.styleFamily,
        form: recipe.subject,
        frame: recipe.aspectRatio,
        medium: recipe.providerId,
      },
      utterance: prompt,
      traits,
      lineage: { kind: 'founder' },
      params,
      title,
      origin,
      // The wish persists as provenance (foundation.3/.4) beside the machine prompt
      // — the gap between them is the Well's art. Absent for the firehose AND the
      // self-portrait (neither carries a human wish).
      ...(occasion?.kind === 'wish' ? { wish: occasion.wish } : {}),
    },
    { env },
  )

  // [LAW:one-type-per-behavior] foundation.7 — the signed remark is the first
  // instance of the voice layer (utter), narrating the COMPLETED slop. The voice
  // reads a done snapshot and never triggers the act, so the remark is authored
  // AFTER createPost with the minted id. Only a WISH produces an AnsweredWish to
  // narrate: the firehose (no occasion) and the self-portrait (no human, nothing
  // answered) have no remark by the shape of the data, not a guard.
  if (occasion?.kind === 'wish') {
    // [LAW:one-source-of-truth] The remark's gist (SlopGist.prompt) is the placard
    // TITLE, not the machine prompt — matching post-card.tsx's SignedRemark, which
    // reconstructs the same utterance from `resultTitle`. Persisting the title here
    // means the stored remark is byte-identical to what the card renders today, and
    // stays correct when the card switches to reading remark_json (once the voice
    // goes LLM-backed and can no longer be recomputed). The named piece — "A
    // Storm-Drowned Tower" — is also the human-meaningful "what the well answered
    // with"; the raw prompt is long machine text the remark was never meant to quote.
    const remark = await utter(
      { handle: persona.agentId, displayName: persona.displayName },
      'remark',
      { wish: occasion.wish, slop: { postId: post.id, prompt: title } },
      {},
    )
    // [LAW:no-silent-fallbacks] exception: a failed remark persist must not lose the
    // slop — the slop is the deliverable and is already committed. recordRemark fails
    // LOUD (throws) at its boundary; here we log + continue so the request still
    // returns the slop. The remark column then stays NULL, which IS the voice layer's
    // "no utterance" (plain absence) — the same degraded value voice.ts's `speak()`
    // produces when a voice itself fails. A loud log, not a silent swallow.
    try {
      await recordRemark(env, post.id, remark)
    } catch (err) {
      // Pass err as a SEPARATE console arg, not an object field: Error's own
      // properties are non-enumerable, so embedding it drops the stack in Workers logs.
      console.error('authorSlop: remark persist failed; slop stands, remark absent', {
        postId: post.id,
        agentId: persona.agentId,
      }, err)
    }
  }

  console.log('authorSlop: posted', {
    postId: post.id,
    agentId: persona.agentId,
    handle: persona.handle,
    displayName: persona.displayName,
    providerId: recipe.providerId,
    styleFamily: recipe.styleFamily,
    subjectTemplate: recipe.subject.subjectTemplate,
    aspectRatio: recipe.aspectRatio,
    occasion: occasion?.kind ?? 'firehose',
  })
  return post
}

// [LAW:types-are-the-program] A breedable parent: an authored generation carrying a genome. Both
// the human Breeding Room and the roomless firehose resolve their two parents to THIS shape before
// crossing — a non-generation has no genome to cross, a non-authored generation is a storage-
// integrity violation. Shared so the cross has one parent contract, not a per-caller copy.
export type BreedableParent = {
  id: PostId
  genome: Genome
  author: AuthoredOrigin['author']
}

// [LAW:single-enforcer] A bred medium that no real provider in this environment serves. The
// crossed medium comes from a parent that rendered with it, so this only fires for a legacy/mock
// providerId the prod registry filters out — surfaced loud (the HTTP route maps it to 422; the
// firehose logs + skips) rather than rendering through an unavailable medium.
export class BredMediumUnavailableError extends Error {
  constructor(readonly providerId: ProviderId) {
    super(`bred medium not available in this environment: ${providerId}`)
    this.name = 'BredMediumUnavailableError'
  }
}

// [LAW:single-enforcer] The ONE breed-authoring implementation — sexual reproduction's assembly,
// shared by the Breeding Room (api.breed: a human breeder + a crypto seed) and the roomless
// firehose (no human + a scheduled-time seed). They differ ONLY in two VALUES: the entropy `seed`
// and whether a `human` modifier exists. [LAW:one-type-per-behavior] breeding a slop is one
// behavior; the room's old inline assembly collapses into this call, never duplicated beside it.
//
// The child renders through the medium it INHERITED (crossover gives it from exactly one parent);
// the citizen owning that medium is its author (the doc's "out of A, by B" — A on a same-medium
// tie). [LAW:dataflow-not-control-flow] the author is selected by the bred-medium VALUE, not a
// branch into a different origin shape. Throws on provider/composer/creation failure; the caller
// maps it (HTTP status vs firehose log+skip).
export async function authorBredSlop(
  env: Env,
  a: BreedableParent,
  b: BreedableParent,
  seed: number,
  human?: HumanModifier,
): Promise<Post> {
  const bred = breed(a.genome, b.genome, seed)
  const author = bred.genes.medium === a.genome.genes.medium ? a.author : b.author

  const provider = getProvider(bred.genes.medium) // throws UnknownProviderError
  if (!realProviders(env).some((p) => p.id === bred.genes.medium)) {
    throw new BredMediumUnavailableError(bred.genes.medium)
  }

  // The ONE composer authors the child's utterance from the breed occasion — both parents' voices
  // recombined, the child's register steering it. Mates were chosen elsewhere; the machine authors
  // the words (the product invariant). The title is the child's own placard.
  const { prompt: utterance, title } = await composePrompt(
    {
      styleFamily: bred.genes.species,
      subject: bred.genes.form,
      aspectRatio: bred.genes.frame,
      traits: bred.traits,
      occasion: { kind: 'breed', parents: [a.genome.utterance, b.genome.utterance] },
      maxLength: provider.promptMaxLength,
      medium: mediumOf(provider),
    },
    env,
  )
  const params = provider.defaultParamsForRecipe({
    prompt: utterance,
    styleFamily: bred.genes.species,
    seed,
    // [LAW:dataflow-not-control-flow] Breeding crosses two existing slops' genomes; it is
    // NOT a Well wish, so it carries no embalmed-relic intent — the child renders its
    // recombined subject without embalm-negative steering.
    embalmedRelic: false,
  })

  // [LAW:dataflow-not-control-flow] The bred child is AUTHORED by the medium's citizen; the optional
  // human (the breeder, room only) is a MODIFIER, never the author. The conditional spread is data-
  // shaped construction (one origin shape, an optional field), not a branch into a different origin.
  const origin: AuthoredOrigin = {
    kind: 'authored',
    author,
    ...(human ? { human } : {}),
  }

  return createPost(
    {
      kind: 'generation',
      genes: bred.genes,
      utterance,
      traits: bred.traits,
      lineage: bred.lineage,
      params,
      title,
      origin,
    },
    { env },
  )
}

// [LAW:single-enforcer] The firehose's trust boundary for a parent the selection fold chose. The
// candidate came from getNicheGenePool — a succeeded generation the niche voted on — so a null,
// non-generation, or non-authored result here is a delete race or storage-integrity violation, not
// a normal path: fail loud rather than breed a half-resolved parent. [LAW:no-defensive-null-guards]
// exception: these map "the storage contract was violated" to a loud error, like feed.ts's required().
async function loadBreedable(env: Env, id: PostId): Promise<BreedableParent> {
  const post = await getPostById(env, id)
  if (post === null) throw new Error(`runGeneratorPass: selected parent ${id} not found`)
  if (post.content.kind !== 'generation') {
    throw new Error(`runGeneratorPass: selected parent ${id} is not a generation`)
  }
  if (post.origin.kind !== 'authored') {
    throw new Error(`runGeneratorPass: selected parent ${id} has non-authored origin`)
  }
  return { id: post.id, genome: post.content.genome, author: post.origin.author }
}

// [LAW:no-mode-explosion] The top-N fittest slice each niche's selection draws from — the gene-pool
// bound. Surfaced; bounds the cron read and focuses selection on the genomes the niche favors.
const GENE_POOL_SIZE = 64

// [LAW:single-enforcer] The firehose entry. The queue consumer (firehose/gen-queue.ts) delegates
// here for every fire. It owns the reproduction DECISION and dispatch; the two authoring acts are
// authorSlop's / authorBredSlop's. [LAW:dataflow-not-control-flow] The fire reads the niche whose
// taste shapes it, that niche's breedable pool, and folds the selection into a plan — then the plan
// VALUE selects the authoring act. Both arms author a slop (the unconditional side effect); the
// data decides breed-vs-found, never a mode flag. [RECONCILE A] An empty generator pool on the
// founder arm is a loud misconfiguration, never a silent default author.
export async function runGeneratorPass(env: Env, scheduledTimeMs: number): Promise<void> {
  const niche = await pickNiche(env, scheduledTimeMs)
  // scheduledTimeMs is the fire's "now" — the reference point recency decay measures vote age from,
  // so the niche's CURRENT taste outweighs historical accumulation. Reproducible: same fire time →
  // same decayed pool.
  const pool = await getNicheGenePool(env, niche, GENE_POOL_SIZE, scheduledTimeMs)

  // [LAW:dataflow-not-control-flow] The drift floor's breeder lever (drift-floor.ts): the
  // recent pool's sameness raises the founder-injection rate so a converging city breeds less
  // and founds fresh, R7-floored blood more. Read once here and folded into the plan as a
  // scalar — never a "are we converged?" branch. The founder arm's authorSlop reads `recent`
  // again for the chooser; that second point-in-time read is independent and cheap (a narrow
  // indexed projection), and only on the minority founder path.
  const recent = await getRecentRecipes(env, RECENT_WINDOW)
  // [LAW:one-source-of-truth] ONE pressure reading off ONE recent snapshot, fed to BOTH the breeder valve
  // (selectReproduction's founder injection) AND the city's voice (maybeNotice). The mechanism that RELAXES
  // the monoculture and the citizen that REMARKS on it therefore read the identical convergence — they can
  // never disagree about how converged the pool is this fire (drift-floor.ts).
  const pressure = monoculturePressure(recent)
  const plan = selectReproduction(pool, seedHash(scheduledTimeMs, 'reproduce'), pressure)

  await dispatchReproduction(env, plan, scheduledTimeMs)

  // [LAW:no-ambient-temporal-coupling] The Noticing NARRATES the convergence the pool is in — it runs AFTER
  // the slop is authored (the act, then the remark on it), reading the same pre-author `recent`/`pressure`
  // that drove this fire. Self-isolated (its own catch inside), so a voice failure never aborts the fire.
  await maybeNotice(env, recent, pressure, scheduledTimeMs)
}

// [LAW:types-are-the-program] Exhaustive over ReproductionPlan: a new reproduction mode forces a case here
// before it compiles. Bred crosses the two selected parents (author = the medium's citizen); founder seeds
// a fresh bloodline through a picked generator persona, no occasion. Extracted from runGeneratorPass so the
// pass body stays linear (dispatch, then notice) without the switch's early returns swallowing the Noticing.
async function dispatchReproduction(
  env: Env,
  plan: ReproductionPlan,
  scheduledTimeMs: number,
): Promise<void> {
  switch (plan.kind) {
    case 'bred': {
      const a = await loadBreedable(env, plan.parents[0])
      const b = await loadBreedable(env, plan.parents[1])
      await authorBredSlop(env, a, b, seedHash(scheduledTimeMs, 'breed'))
      return
    }
    case 'founder': {
      const persona = await pickPersona(env, 'generator', scheduledTimeMs)
      if (persona === null) {
        throw new Error(
          'runGeneratorPass: no generator personas configured — a slop must be authored by a citizen',
        )
      }
      await authorSlop(env, persona, scheduledTimeMs)
      return
    }
    default: {
      const _exhaustive: never = plan
      return _exhaustive
    }
  }
}

// [LAW:single-enforcer] The Noticing (slopspot-genome-brs, Piece 1) — the city remarks on a monoculture it
// has converged into. The DOCTRINE-SAFE present-tense move: a citizen OBSERVES the sameness; it never declares
// an era for it (doctrine/on-eras.md — eras are conferred in retrospect, never proclaimed in the present).
//
// [LAW:dataflow-not-control-flow] The firing rate IS the convergence pressure — the SAME scalar (drift-floor.ts)
// that opens the breeder's founder valve is the THIRD reader here, as the weight of a two-outcome draw. At
// pressure 0 (a healthy, varied pool) the draw is always `quiet`; as the pool converges the rate climbs toward
// always-`notice`. No threshold constant, no `if (converged)` — the one number governs the chooser floor, the
// breeder injection, AND the city's voice, all complements about the same sameness. The draw is seeded by the
// fire time (reproducible), decorrelated from the reproduce/breed draws by its own `kind` tag.
//
// [LAW:no-silent-failure] Every path emits its outcome. ISOLATED + best-effort like revealGrace: the slop is
// already authored (primary truth); a voice/persist failure here is caught, surfaced on its own signal, and
// never propagated as a fire failure. Exported (not inlined) so the firing gate is verifiable directly from a
// (recent, pressure) pair, without driving the whole reproduction/createPost/provider path.
export async function maybeNotice(
  env: Env,
  recent: readonly RecentRecipe[],
  pressure: number,
  scheduledTimeMs: number,
): Promise<void> {
  try {
    // The convergence reading is genuine optionality: a varied/empty pool has no over-represented family,
    // so there is nothing to notice — handled as a value, not a thrown guard. [LAW:no-defensive-null-guards]
    const convergence = dominantFamily(recent)
    if (convergence === null) {
      emit('slopspot.firehose.noticing', { outcome: 'no-convergence' }, 1)
      return
    }
    // The pressure-weighted draw — pressure is the rate. `quiet` dominates a healthy pool; the city only
    // speaks as the sameness mounts. (pickWeighted requires a positive total; pressure∈[0,1] keeps it 1.)
    const draw = pickWeighted(
      ['notice', 'quiet'] as const,
      [pressure, 1 - pressure],
      seedHash(scheduledTimeMs, 'notice'),
      'notice',
    )
    if (draw === 'quiet') {
      emit('slopspot.firehose.noticing', { outcome: 'quiet' }, 1)
      return
    }
    // A critic voices the noticing — the citizens whose work is judging variety are the ones who notice its
    // loss. A deterministic pick by fire time keeps the speaker reproducible and the chorus varied across
    // convergences. A null pool (no voter personas seeded) is an observable no-op: the mechanism still ran,
    // there is simply no one to speak. [LAW:no-silent-failure]
    const noticer = await pickPersona(env, 'voter', scheduledTimeMs)
    if (noticer === null) {
      emit('slopspot.firehose.noticing', { outcome: 'no-noticer' }, 1)
      return
    }
    const speaker: PersonaRef = { handle: noticer.agentId, displayName: noticer.displayName }
    const utterance = await utter(
      speaker,
      'noticing',
      { family: convergence.label, count: convergence.count, representative: convergence.representative },
      {},
    )
    await recordUtterance(env, {
      speaker: noticer.agentId,
      occasion: 'noticing',
      targetPostId: convergence.representative,
      utterance,
    })
    emit('slopspot.firehose.noticing', { outcome: 'noticed' }, 1)
  } catch (err) {
    // A noticing failure is observable on its OWN outcome, never an aborted fire — the slop is already
    // authored. [LAW:no-silent-failure] a swallowed throw mislabelled as a clean no-op is exactly the lie
    // this avoids.
    emit('slopspot.firehose.noticing', { outcome: 'failed' }, 1)
    console.error('[noticing] failed — the fire stands, the remark did not', err)
  }
}
