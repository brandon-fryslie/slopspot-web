// [LAW:single-enforcer] The only entry point for generator-persona-driven post
// creation. runOneFire (firehose/scheduled.ts) delegates here for every channel
// fire; runAgentPass dispatches here for the 'generator' role in the agent-pass
// cron. Both paths share one implementation.
//
// [LAW:dataflow-not-control-flow] Persona biases are multipliers forwarded to
// chooseNextGeneration as PersonaBias. Absent persona = absent bias = all-ones
// in every weight function — same code path every fire, no branch around the
// chooser body. When no persona is configured (bootstrap / role empty), the
// system agent is used and bias is absent.
//
// [LAW:types-are-the-program] GeneratorPersonaConfig is the typed projection of
// the persona's config_json blob for role='generator'. Parsed at the trust
// boundary (this function); callers pass the raw Persona from pickPersona.

import { z } from 'zod'
import { AgentId } from '~/lib/domain'
import { createPost } from '~/db/posts'
import { getRecentRecipes } from '~/db/recent'
import { pickPersona } from '~/agents/persona'
import { chooseNextGeneration } from '~/firehose/chooseNextGeneration'
import { ASPECT_RATIOS, STYLE_FAMILIES, type AspectRatio, type StyleFamily } from '~/lib/variety'
import { realProviders } from '~/providers'

const RECENT_WINDOW = 20

// [LAW:one-source-of-truth] The system-agent identity for generator fires when
// no persona is configured. Same constant as the old firehose CRON_AGENT_ID;
// kept here since runGeneratorPass is the single enforcer for post creation.
const SYSTEM_AGENT_ID = AgentId('sys:slop-cron')

const styleFamilyBiasSchema = z
  .object(Object.fromEntries(STYLE_FAMILIES.map((s) => [s, z.number().positive().optional()])))
  .partial()
  .optional()

const aspectRatioBiasSchema = z
  .object(Object.fromEntries(ASPECT_RATIOS.map((a) => [a, z.number().positive().optional()])))
  .partial()
  .optional()

const generatorPersonaConfigSchema = z.object({
  styleFamilyBias: styleFamilyBiasSchema,
  providerBias: z.record(z.string(), z.number().positive()).optional(),
  aspectRatioBias: aspectRatioBiasSchema,
  promptPrefix: z.string().optional(),
})

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

// [LAW:single-enforcer] One implementation for all generator fires. Always
// creates a post — when no persona is available (empty pool / bootstrap),
// falls back to the system agent with no bias. This gives "behaviorally
// equivalent until persona rows exist" semantics without an early-return branch.
// Throws on any I/O or creation failure; the caller (runOneFire / runAgentPass)
// owns error handling and metric emission.
export async function runGeneratorPass(env: Env, scheduledTimeMs: number): Promise<void> {
  const persona = await pickPersona(env, 'generator', scheduledTimeMs)

  const recent = await getRecentRecipes(env, RECENT_WINDOW)
  const providers = realProviders(env)

  const config = persona ? parseGeneratorConfig(persona.config, persona.agentId) : undefined
  const bias = config
    ? {
        styleFamilyBias: config.styleFamilyBias as Partial<Record<StyleFamily, number>> | undefined,
        providerBias: config.providerBias,
        aspectRatioBias: config.aspectRatioBias as Partial<Record<AspectRatio, number>> | undefined,
        promptPrefix: config.promptPrefix,
      }
    : undefined

  const recipe = chooseNextGeneration({ scheduledTimeMs, recent, providers, bias })

  const agentId = persona?.agentId ?? SYSTEM_AGENT_ID

  const post = await createPost(
    {
      kind: 'generation',
      providerId: recipe.providerId,
      params: recipe.params,
      styleFamily: recipe.styleFamily,
      subject: recipe.subject,
      aspectRatio: recipe.aspectRatio,
      origin: { actor: { kind: 'agent', agentId } },
    },
    { env },
  )

  console.log('generator: posted', {
    postId: post.id,
    agentId,
    displayName: persona?.displayName ?? null,
    providerId: recipe.providerId,
    styleFamily: recipe.styleFamily,
    subjectTemplate: recipe.subject.subjectTemplate,
    aspectRatio: recipe.aspectRatio,
  })
}
