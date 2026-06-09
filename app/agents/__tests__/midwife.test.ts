// [LAW:behavior-not-structure] The Birth Engine's contract: the midwife's untrusted JSON is parsed
// at the boundary (bad shapes re-roll, never birth a malformed citizen); a newborn must be DISTINCT
// from the living cast (handle/name/creed/sensibility); a built persona always passes the EXISTING
// generator config enforcer; the daily birth is idempotent (a re-fire of a settled day writes
// nothing); and a day with no authorable citizen is an OBSERVABLE skip, never a fallback citizen.
// The live LLM author call is the one seam exercised by the curl-scheduled gate, not unit-mocked.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { db } from '~/db/client'
import { personas, utterances } from '~/db/schema'
import { eq } from 'drizzle-orm'
import { parseGeneratorConfig } from '~/agents/generator'
import { createPersona, getPersona, type NewPersona, type Persona } from '~/agents/persona'
import {
  announceBirth,
  birthDayKey,
  bornAgentId,
  buildMidwifePrompt,
  buildNewPersona,
  checkDistinct,
  gapGate,
  gapTarget,
  parsePersonaSpec,
  runBirth,
  type MidwifeSpec,
} from '~/agents/midwife'
import { getPulse } from '~/db/pulse'
import { AgentId, ProviderId, type TraitVector } from '~/lib/domain'

const NEUTRAL: TraitVector = { austerity: 0.5, curse: 0.5, density: 0.5, earnestness: 0.5 }

// The test's own L1-to-nearest, mirroring the module's private metric — used only to assert a gap
// target's distance to the cast (the production metric is exercised through gapTarget/gapGate).
function nearestL1Of(point: TraitVector, cast: readonly TraitVector[]): number {
  const axes = ['austerity', 'curse', 'density', 'earnestness'] as const
  return Math.min(...cast.map((c) => axes.reduce((s, a) => s + Math.abs(point[a] - c[a]), 0)))
}

function spec(over: Partial<MidwifeSpec> = {}): MidwifeSpec {
  return {
    displayName: 'Idris Vane',
    handle: 'idris-vane',
    personaPrompt: 'You are Idris Vane — a cartographer of empty rooms who renders absence as architecture.',
    creed: 'The room remembers.',
    promptPrefix: 'cold, exact, reverent toward the vacant',
    medium: 'fal-flux',
    traits: { austerity: 0.9, curse: 0.2, density: 0.1, earnestness: 0.8 },
    ...over,
  }
}

function persona(over: Partial<Persona> = {}): Persona {
  return {
    agentId: AgentId('agent:existing'),
    handle: 'existing-one',
    displayName: 'The Existing One',
    role: 'generator',
    personaPrompt: 'You are The Existing One — a maker of loud things.',
    modelId: 'claude-haiku-4-5-20251001',
    config: { medium: 'fal-flux', creed: 'Louder.' },
    traits: NEUTRAL,
    ...over,
  }
}

describe('parsePersonaSpec — the midwife output is parsed at the trust boundary', () => {
  it('parses a clean minified JSON spec', () => {
    expect(parsePersonaSpec(JSON.stringify(spec()))).toEqual(spec())
  })

  it('tolerates a ```json markdown fence and trailing prose (composer extractor reuse)', () => {
    const wrapped = '```json\n' + JSON.stringify(spec()) + '\n```\nthere, a new soul.'
    expect(parsePersonaSpec(wrapped)).toEqual(spec())
  })

  it('returns null on no JSON object, malformed JSON, a missing field, and a bad trait', () => {
    expect(parsePersonaSpec('a citizen, surely')).toBeNull()
    expect(parsePersonaSpec('{ "displayName": ')).toBeNull()
    const missing: Record<string, unknown> = { ...spec() }
    delete missing.creed
    expect(parsePersonaSpec(JSON.stringify(missing))).toBeNull()
    expect(parsePersonaSpec(JSON.stringify(spec({ traits: { ...NEUTRAL, curse: 5 } })))).toBeNull()
  })

  it('rejects an unknown key (.strict — a stray field is a malformed spec)', () => {
    expect(parsePersonaSpec(JSON.stringify({ ...spec(), role: 'voter' }))).toBeNull()
  })

  it('rejects a non-slug handle', () => {
    expect(parsePersonaSpec(JSON.stringify(spec({ handle: 'Idris Vane!' })))).toBeNull()
  })
})

describe('checkDistinct — a newborn must not duplicate the living cast', () => {
  it('an empty city makes the first citizen trivially distinct', () => {
    expect(checkDistinct(spec(), [])).toEqual({ ok: true })
  })

  it('passes when handle, name, creed, and sensibility are all distinct', () => {
    expect(checkDistinct(spec(), [persona()])).toEqual({ ok: true })
  })

  it('rejects a taken handle, a taken name, a duplicate creed, and a too-close sensibility', () => {
    expect(checkDistinct(spec(), [persona({ handle: 'idris-vane' })]).ok).toBe(false)
    expect(checkDistinct(spec(), [persona({ displayName: 'idris vane' })]).ok).toBe(false)
    expect(checkDistinct(spec({ creed: 'Louder.' }), [persona({ config: { creed: 'Louder.' } })]).ok).toBe(false)
    // Same sensibility as an existing neutral citizen → trait distance 0 < the floor.
    expect(checkDistinct(spec({ traits: NEUTRAL }), [persona({ traits: NEUTRAL })]).ok).toBe(false)
  })
})

describe('buildNewPersona — the spec becomes a generator row that passes the existing enforcer', () => {
  it('fixes role=generator and its config passes parseGeneratorConfig', () => {
    const id = AgentId('agent:born-2026-06-04')
    const p = buildNewPersona(spec(), id)
    expect(p.role).toBe('generator')
    expect(p.agentId).toBe(id)
    expect(p.traits).toEqual(spec().traits)
    // The fail-loud write gate: the authored config is exactly what the generator enforcer admits.
    expect(() => parseGeneratorConfig(p.config, id)).not.toThrow()
    expect(p.config).toEqual({ medium: 'fal-flux', creed: 'The room remembers.', promptPrefix: 'cold, exact, reverent toward the vacant' })
  })
})

describe('buildMidwifePrompt — carries the cast and the JSON contract', () => {
  it('names the living cast (for distinctness) and demands the JSON shape', () => {
    const p = buildMidwifePrompt([persona()], ['fal-flux', 'replicate-sdxl'], null, undefined)
    expect(p).toContain('The Existing One')
    expect(p).toContain('fal-flux, replicate-sdxl')
    expect(p).toContain('"handle"')
  })

  it('feeds the prior collision back on a re-roll', () => {
    const p = buildMidwifePrompt([], ['fal-flux'], null, 'the handle "x" is already taken')
    expect(p).toContain('rejected')
    expect(p).toContain('already taken')
  })

  it('steers toward the gap target when one exists, and omits the directive when null', () => {
    const gap: TraitVector = { austerity: 0.1, curse: 0.9, density: 0.2, earnestness: 0.7 }
    const steered = buildMidwifePrompt([persona()], ['fal-flux'], gap, undefined)
    expect(steered).toContain('BORN TO FILL A GAP')
    expect(steered).toContain('austerity 0.10')
    expect(steered).toContain('curse 0.90')

    const unsteered = buildMidwifePrompt([persona()], ['fal-flux'], null, undefined)
    expect(unsteered).not.toContain('BORN TO FILL A GAP')
  })
})

describe('gapTarget — the under-cultivated corner of the taste cube (PURE)', () => {
  const at = (austerity: number, curse: number, density: number, earnestness: number): TraitVector => ({
    austerity,
    curse,
    density,
    earnestness,
  })

  it('picks the art region that radiated FARthest from every citizen', () => {
    // One citizen clustered low; art mostly near it but a CLUSTER at the far corner. The top-K mean
    // lands on that cluster (a lone spike would be diluted by the stability mean — which is the point).
    const cast = [at(0.1, 0.1, 0.1, 0.1)]
    const art = [
      at(0.12, 0.1, 0.1, 0.1),
      at(0.1, 0.12, 0.1, 0.1),
      at(0.9, 0.9, 0.9, 0.9),
      at(0.92, 0.9, 0.9, 0.9),
      at(0.9, 0.92, 0.9, 0.9),
    ]
    const gap = gapTarget(cast, art)
    expect(gap).not.toBeNull()
    // The far cluster dominates the top-K mean — every axis pulled high, away from the citizen.
    expect(gap!.austerity).toBeGreaterThan(0.8)
    expect(gap!.curse).toBeGreaterThan(0.8)
  })

  it('yields a target ON the cast when all art sits ON it (no gap radiated)', () => {
    const cast = [at(0.4, 0.4, 0.4, 0.4)]
    const art = [at(0.4, 0.4, 0.4, 0.4), at(0.4, 0.4, 0.4, 0.4)]
    const gap = gapTarget(cast, art)
    expect(gap).not.toBeNull()
    // No art radiated away from the citizen, so the furthest-art target sits on the citizen itself.
    expect(nearestL1Of(gap!, cast)).toBeLessThan(0.01)
  })

  it('returns null when there is no landscape to read (empty cast OR empty art)', () => {
    expect(gapTarget([], [at(0.5, 0.5, 0.5, 0.5)])).toBeNull()
    expect(gapTarget([at(0.5, 0.5, 0.5, 0.5)], [])).toBeNull()
  })
})

describe('gapGate — the newborn must land emptier than a typical citizen (PURE)', () => {
  const at = (austerity: number, curse: number, density: number, earnestness: number): TraitVector => ({
    austerity,
    curse,
    density,
    earnestness,
  })
  const gap: TraitVector = { austerity: 0.9, curse: 0.9, density: 0.9, earnestness: 0.9 }

  // A cast clumped tightly in one corner: typical nearest-neighbor distance is small.
  const clumpedCast = [at(0.1, 0.1, 0.1, 0.1), at(0.12, 0.1, 0.1, 0.1), at(0.1, 0.12, 0.1, 0.1)]

  it('accepts a newborn that lands in a genuinely less-crowded region', () => {
    const spread = at(0.9, 0.9, 0.9, 0.9)
    expect(gapGate(spread, clumpedCast, gap)).toEqual({ ok: true })
  })

  it('rejects a newborn that clumps into the crowd, with a reason for the re-roll', () => {
    const clumped = at(0.11, 0.1, 0.1, 0.1)
    const verdict = gapGate(clumped, clumpedCast, gap)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toContain('crowded')
  })

  it('cannot reject when no gap was targeted or there is no crowding baseline', () => {
    expect(gapGate(at(0.1, 0.1, 0.1, 0.1), clumpedCast, null)).toEqual({ ok: true })
    expect(gapGate(at(0.1, 0.1, 0.1, 0.1), [at(0.1, 0.1, 0.1, 0.1)], gap)).toEqual({ ok: true })
  })
})

describe('birthDayKey / bornAgentId — deterministic per-UTC-day identity', () => {
  it('derives the same day key and id for any instant within a UTC day', () => {
    const ms = Date.UTC(2026, 5, 4, 14, 30)
    expect(birthDayKey(ms)).toBe('2026-06-04')
    expect(bornAgentId('2026-06-04')).toBe(AgentId('agent:born-2026-06-04'))
  })
})

describe('createPersona — the single writer, idempotent on the agentId PK', () => {
  it('writes a citizen and a re-insert of the same id is a no-op', async () => {
    const newborn: NewPersona = {
      agentId: AgentId('agent:born-test-1'),
      handle: 'born-test-1',
      displayName: 'Test Newborn',
      role: 'generator',
      personaPrompt: 'You are Test Newborn — a probe.',
      modelId: 'claude-haiku-4-5-20251001',
      config: { medium: 'fal-flux', creed: 'A test soul.' },
      traits: { austerity: 0.7, curse: 0.3, density: 0.2, earnestness: 0.6 },
    }
    expect((await createPersona(env, newborn)).created).toBe(true)
    // Read back through the persona system — the row round-trips.
    const read = await getPersona(env, 'agent:born-test-1')
    expect(read).toMatchObject({ handle: 'born-test-1', displayName: 'Test Newborn', role: 'generator' })
    expect(read?.traits).toEqual(newborn.traits)

    // A second insert of the same agentId writes nothing (the daily idempotency guarantee).
    expect((await createPersona(env, newborn)).created).toBe(false)
    const rows = await db(env).select().from(personas).where(eq(personas.agentId, 'agent:born-test-1'))
    expect(rows).toHaveLength(1)
  })
})

describe('runBirth — daily, deterministic, observable', () => {
  it('a settled day short-circuits: an already-born day re-fires to no new citizen, no LLM call', async () => {
    const ms = Date.UTC(2026, 0, 2, 3, 0)
    const id = bornAgentId(birthDayKey(ms))
    await createPersona(env, {
      agentId: id,
      handle: 'jan-2-citizen',
      displayName: 'January Second',
      role: 'generator',
      personaPrompt: 'You are January Second.',
      modelId: 'claude-haiku-4-5-20251001',
      config: { medium: 'fal-flux', creed: 'Born once.' },
      traits: { austerity: 0.1, curse: 0.9, density: 0.8, earnestness: 0.2 },
    })
    // The settled-check returns the existing citizen WITHOUT authoring (no network touched).
    expect(await runBirth(env, ms)).toEqual({ kind: 'already-born', agentId: id })

    // [LAW:dataflow-not-control-flow] The no-double-announce gate, deterministically: a settled-day
    // re-run is created:false, so it NEVER reaches the announcement — no birth utterance is written.
    // The unique index cannot dedup births (NULL target → distinct), so this `created`-gate IS the only
    // thing preventing a second welcome, and this asserts it holds without needing the LLM author path.
    const births = await db(env).select().from(utterances).where(eq(utterances.occasion, 'birth'))
    expect(births).toHaveLength(0)
  })

  it('skips loudly (no fallback citizen) when no author is available', async () => {
    const ms = Date.UTC(2026, 0, 3, 3, 0)
    // No Anthropic key → every authoring attempt yields null → an honest, observable skip.
    const noKeyEnv = { ...env, SLOPSPOT_ANTHROPIC_API_KEY: '' } as Env
    expect(await runBirth(noKeyEnv, ms)).toEqual({ kind: 'skipped', reason: 'llm' })
    // The cadence miss wrote NO citizen for the day.
    expect(await getPersona(env, bornAgentId(birthDayKey(ms)))).toBeNull()
  })
})

// [LAW:behavior-not-structure] The Birth Rite's contract against a real D1 isolate: the Proprietor (seeded
// by migration, the SAME host the Daily Rite uses) welcomes a newborn through the ONE Voice mechanism —
// one persisted 'birth' utterance NAMING the newcomer, surfaced on the Pulse as a 'born' event. This is
// the announce path the LLM-gated runBirth calls; testing it directly is what makes the gate machine-
// verifiable without the (egress-less in dev) author call. The no-double-announce half is pinned by the
// settled-day runBirth test above (created:false → zero birth utterances).
describe('announceBirth — the Proprietor welcomes a newborn through the one Voice', () => {
  it('records exactly one birth utterance naming the newcomer, and surfaces it on the Pulse', async () => {
    const newcomer = { displayName: 'Sindri Cole', creed: 'Rust is a slow hymn.', medium: ProviderId('verse') }
    // The announce is a command — its truth is the persisted row + the Pulse event, asserted below.
    await announceBirth(env, newcomer)

    // Exactly one post-less 'birth' utterance, in the Proprietor's voice, NAMING the newcomer.
    const rows = await db(env).select().from(utterances).where(eq(utterances.occasion, 'birth'))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.targetPostId).toBeNull()
    expect(rows[0]!.kind).toBe('spoke')
    expect(rows[0]!.text).toContain('Sindri Cole')

    // Surfaced on the Pulse as a single 'born' event carrying the welcome line.
    const born = (await getPulse(env, Date.UTC(2026, 0, 9, 12))).filter((e) => e.kind === 'born')
    expect(born).toHaveLength(1)
    expect(born[0]!).toMatchObject({ kind: 'born', text: expect.stringContaining('Sindri Cole') })
  })

  // [LAW:no-silent-fallbacks] The isolation invariant: the welcome is best-effort NARRATION of a birth
  // that already happened. A failure to voice it (here: the Proprietor not seated, so proprietorRef
  // throws) must be CAUGHT and observable — never propagated as an exception that would un-birth a
  // citizen the caller already wrote. announceBirth is TOTAL: it resolves, writes no utterance, and the
  // failure is surfaced on slopspot.birth.announce (a loud log), not raised.
  it('a welcome that cannot be voiced is isolated — resolves without throwing, writes no utterance', async () => {
    // Remove the migration-seeded Proprietor (rolled back after this test by isolated storage) so the
    // announce path hits a real failure inside announceBirth.
    await db(env).delete(personas).where(eq(personas.handle, 'the-proprietor'))

    await expect(
      announceBirth(env, { displayName: 'Unwelcomed One', creed: 'No bell rang.', medium: ProviderId('verse') }),
    ).resolves.toBeUndefined()

    const births = await db(env).select().from(utterances).where(eq(utterances.occasion, 'birth'))
    expect(births).toHaveLength(0)
  })
})
