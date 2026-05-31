// [LAW:single-enforcer] The only entry point for generator-persona-driven post
// creation. runOneFire (firehose/scheduled.ts) delegates here for every channel
// fire.
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
// boundary (this function); callers pass the raw Persona from pickPersona.

import { z } from 'zod'
import { ProviderId } from '~/lib/domain'
import { createPost } from '~/db/posts'
import { getRecentRecipes } from '~/db/recent'
import { pickPersona } from '~/agents/persona'
import { chooseNextGeneration } from '~/firehose/chooseNextGeneration'
import { composePrompt } from '~/firehose/composer'
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
}).strict()

type GeneratorPersonaConfig = z.infer<typeof generatorPersonaConfigSchema>

function parseGeneratorConfig(raw: Record<string, unknown>, agentId: string): GeneratorPersonaConfig {
  const result = generatorPersonaConfigSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(
      `generator persona ${agentId}: config_json failed validation — ${result.error.message}`,
    )
  }
  return result.data
}

// [LAW:single-enforcer] One implementation for all generator fires.
// [RECONCILE A] A slop is authored by a persona, always — so a persona is the
// function's precondition. An empty generator pool is a loud misconfiguration
// (the seed migrations guarantee a non-empty pool), never a silent default
// author. Throws on any I/O or creation failure; the caller (runOneFire) owns
// error handling and metric emission.
export async function runGeneratorPass(env: Env, scheduledTimeMs: number): Promise<void> {
  const persona = await pickPersona(env, 'generator', scheduledTimeMs)
  if (persona === null) {
    throw new Error(
      'runGeneratorPass: no generator personas configured — a slop must be authored by a citizen',
    )
  }

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
      `runGeneratorPass: persona ${persona.agentId} has mock medium ${provider.id} in prod`,
    )
  }

  // [RECONCILE C] bias carries only the dimensions the chooser samples. promptPrefix
  // steers composition, so it flows straight to composePrompt below — not through here.
  const bias = {
    styleFamilyBias: config.styleFamilyBias as Partial<Record<StyleFamily, number>> | undefined,
    aspectRatioBias: config.aspectRatioBias as Partial<Record<AspectRatio, number>> | undefined,
  }

  const recipe = chooseNextGeneration({ scheduledTimeMs, recent, provider, bias })

  // [LAW:single-enforcer] composePrompt is the one place prompt text is
  // generated from a recipe; promptPrefix and maxLength flow from the provider's
  // declared constraint so paramsSchema validation never rejects a too-long prompt.
  const prompt = await composePrompt(
    {
      styleFamily: recipe.styleFamily,
      subject: recipe.subject,
      aspectRatio: recipe.aspectRatio,
      promptPrefix: config.promptPrefix,
      maxLength: provider.promptMaxLength,
    },
    env,
  )
  const params = provider.defaultParamsForRecipe({
    prompt,
    styleFamily: recipe.styleFamily,
    seed: recipe.paramsSeed,
  })

  const post = await createPost(
    {
      kind: 'generation',
      providerId: recipe.providerId,
      params,
      styleFamily: recipe.styleFamily,
      subject: recipe.subject,
      aspectRatio: recipe.aspectRatio,
      // [LAW:types-are-the-program] The firehose AUTHORS as a persona — no human
      // modifier. author is the citizen; that is the whole attribution.
      origin: { kind: 'authored', author: { kind: 'agent', agentId: persona.agentId } },
    },
    { env },
  )

  console.log('generator: posted', {
    postId: post.id,
    agentId: persona.agentId,
    handle: persona.handle,
    displayName: persona.displayName,
    providerId: recipe.providerId,
    styleFamily: recipe.styleFamily,
    subjectTemplate: recipe.subject.subjectTemplate,
    aspectRatio: recipe.aspectRatio,
  })
}
