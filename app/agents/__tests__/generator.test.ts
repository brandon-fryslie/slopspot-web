// [LAW:behavior-not-structure] Locks criterion 2 of the foundation.1 gate: the
// seeded generator personas parse under the .strict() GeneratorPersonaConfig with
// a medium present and no leftover providerBias key. This asserts the REAL parse
// contract — it runs the actual parseGeneratorConfig over the actual D1-seeded
// config_json rows (the migrations are applied to this isolate), not a typeof
// proxy or a reconstructed schema. If a migration ever seeds a generator whose
// config violates the strict schema, this fails loud instead of surfacing only as
// a runtime firehose error on first fire.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { listPersonas } from '../persona'
import { parseAuthoringConfig, parseGeneratorConfig } from '../generator'

describe('generator config_json parse contract (seeded rows)', () => {
  it('every seeded generator config parses with a medium present', async () => {
    // [LAW:one-source-of-truth] The rows under test are the live migration-seeded
    // generators — the same source the firehose reads — not hand-copied fixtures.
    const generators = await listPersonas(env, 'generator')
    expect(generators.length).toBeGreaterThan(0)

    for (const g of generators) {
      const config = parseGeneratorConfig(g.config, g.agentId)
      expect(config.medium.length).toBeGreaterThan(0)
      // The strict schema strips nothing — a leftover providerBias key (the legacy
      // shape the 0008 prose mentions but the JSON never carried) would have thrown
      // above. Assert its absence on the raw row too, so the lock is explicit.
      expect(g.config).not.toHaveProperty('providerBias')
    }
  })

  it('rejects a config carrying a leftover providerBias key (.strict())', async () => {
    // Ground the negative case in a real seeded config so we reject the exact
    // legacy shape, mutated by one stray key — not a fabricated object.
    const [seed] = await listPersonas(env, 'generator')
    const legacy = { ...seed.config, providerBias: { 'fal-flux': 2 } }

    expect(() => parseGeneratorConfig(legacy, seed.agentId)).toThrow(/failed validation/)
  })

  it('rejects a config missing its required medium', async () => {
    const [seed] = await listPersonas(env, 'generator')
    const withoutMedium = { ...seed.config }
    delete withoutMedium.medium

    expect(() => parseGeneratorConfig(withoutMedium, seed.agentId)).toThrow(/failed validation/)
  })
})

// [LAW:behavior-not-structure] Locks the roll-call-f7n cross-role split: a CRITIC given
// a face (migration 0046) sits for a self-portrait through authorSlop, which reads the
// GENERATION VIEW (parseAuthoringConfig). A critic's config legitimately carries its
// VOTER thresholds — keys owned by the voter boundary, not the generator's. The
// authoring view must TOLERATE them (so the portrait pass can render the face) while the
// strict write gate must still REJECT them (a generator config carries only its own
// keys). Grounded in the live seeded voter rows, not fixtures — the same source the
// portrait pass reads.
describe('authoring config view tolerates a cross-role persona (roll-call-f7n)', () => {
  it('parses a faced critic config — medium present, voter thresholds tolerated', async () => {
    const voters = await listPersonas(env, 'voter')
    // The critics 0046 gave a face (the Gremlin refused, so it carries no medium).
    const faced = voters.find((v) => typeof v.config.medium === 'string')
    expect(faced, 'a seeded voter should carry a portrait medium after 0046').toBeDefined()
    if (!faced) return

    const config = parseAuthoringConfig(faced.config, faced.agentId)
    expect(config.medium.length).toBeGreaterThan(0)
    // The voter's own thresholds remain on the raw row (owned by the voter boundary);
    // the authoring view simply does not carry them — it never rejects them.
    expect(faced.config).toHaveProperty('upvoteThreshold')
  })

  it('the strict write gate still REJECTS that same critic config (foreign keys)', async () => {
    const voters = await listPersonas(env, 'voter')
    const faced = voters.find((v) => typeof v.config.medium === 'string')
    expect(faced).toBeDefined()
    if (!faced) return

    // The voter thresholds are not generator keys — the write gate fails loud, proving
    // the two parses are genuinely different theorems, not a renamed alias.
    expect(() => parseGeneratorConfig(faced.config, faced.agentId)).toThrow(/failed validation/)
  })
})
