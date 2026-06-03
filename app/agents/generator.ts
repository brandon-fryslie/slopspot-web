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
import { ProviderId, type AuthoredOrigin, type HumanModifier, type HumanRef, type Post } from '~/lib/domain'
import { createPost } from '~/db/posts'
import { getRecentRecipes } from '~/db/recent'
import { recordRemark } from '~/db/remark'
import { pickPersona, type Persona } from '~/agents/persona'
import { chooseNextGeneration } from '~/firehose/chooseNextGeneration'
import { composePrompt, type ComposerOccasion } from '~/firehose/composer'
import { NEUTRAL_TRAITS } from '~/lib/traits'
import { utter } from '~/lib/voice'
import { ASPECT_RATIOS, STYLE_FAMILIES, type AspectRatio, type StyleFamily } from '~/lib/variety'
import { getProvider } from '~/providers'

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
      promptPrefix: config.promptPrefix,
      // The occasion (a wish, a self-portrait, or none) flows as one closed value —
      // the composer cannot receive both a wish and a self-portrait by construction.
      occasion: composerOccasionOf(occasion, persona.displayName),
      maxLength: provider.promptMaxLength,
    },
    env,
  )
  const params = provider.defaultParamsForRecipe({
    prompt,
    styleFamily: recipe.styleFamily,
    seed: recipe.paramsSeed,
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
      // so its lineage is `founder`. Traits start neutral — the firehose seeds no drift; that
      // arrives with breeding (L2) and selection (L3).
      genes: {
        species: recipe.styleFamily,
        form: recipe.subject,
        frame: recipe.aspectRatio,
        medium: recipe.providerId,
      },
      utterance: prompt,
      traits: NEUTRAL_TRAITS,
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
    const remark = utter(
      { handle: persona.agentId, displayName: persona.displayName },
      'remark',
      { wish: occasion.wish, slop: { postId: post.id, prompt: title } },
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

// [LAW:single-enforcer] The firehose entry. runOneFire (firehose/scheduled.ts)
// delegates here for every channel fire. It owns only persona SELECTION (a
// deterministic pick by scheduled time); authoring is authorSlop's. [RECONCILE A]
// An empty generator pool is a loud misconfiguration (seed migrations guarantee a
// non-empty pool), never a silent default author.
export async function runGeneratorPass(env: Env, scheduledTimeMs: number): Promise<void> {
  const persona = await pickPersona(env, 'generator', scheduledTimeMs)
  if (persona === null) {
    throw new Error(
      'runGeneratorPass: no generator personas configured — a slop must be authored by a citizen',
    )
  }
  // The firehose passes no occasion — a citizen firing on its own, no human, no wish.
  await authorSlop(env, persona, scheduledTimeMs)
}
