// [LAW:behavior-not-structure] The Birth Engine's contract: the midwife's untrusted JSON is parsed
// at the boundary (bad shapes re-roll, never birth a malformed citizen); a newborn must be DISTINCT
// from the living cast (handle/name/creed/sensibility); a built persona always passes the EXISTING
// generator config enforcer; the daily birth is idempotent (a re-fire of a settled day writes
// nothing); and a day with no authorable citizen is an OBSERVABLE skip, never a fallback citizen.
// The live LLM author call is the one seam exercised by the curl-scheduled gate, not unit-mocked.

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { db } from '~/db/client'
import { personas } from '~/db/schema'
import { eq } from 'drizzle-orm'
import { parseGeneratorConfig } from '~/agents/generator'
import { createPersona, getPersona, type NewPersona, type Persona } from '~/agents/persona'
import {
  birthDayKey,
  bornAgentId,
  buildMidwifePrompt,
  buildNewPersona,
  checkDistinct,
  parsePersonaSpec,
  runBirth,
  type MidwifeSpec,
} from '~/agents/midwife'
import { AgentId, type TraitVector } from '~/lib/domain'

const NEUTRAL: TraitVector = { austerity: 0.5, curse: 0.5, density: 0.5, earnestness: 0.5 }

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
    const p = buildMidwifePrompt([persona()], ['fal-flux', 'replicate-sdxl'], undefined)
    expect(p).toContain('The Existing One')
    expect(p).toContain('fal-flux, replicate-sdxl')
    expect(p).toContain('"handle"')
  })

  it('feeds the prior collision back on a re-roll', () => {
    const p = buildMidwifePrompt([], ['fal-flux'], 'the handle "x" is already taken')
    expect(p).toContain('rejected')
    expect(p).toContain('already taken')
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
