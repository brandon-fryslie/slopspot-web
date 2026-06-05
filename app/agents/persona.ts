// [LAW:single-enforcer] The only module that reads/writes the personas table.
// All persona-driven actions (vote, discover, generate) obtain their persona
// via listPersonas or pickPersona — no direct D1 reads elsewhere.
//
// [LAW:types-are-the-program] PersonaRole is a closed discriminated union.
// Each acting role's executor lives wherever that role runs: voter and discoverer
// are homelab Nomad services (services/voter, services/discoverer) that read these
// rows over the D1 REST API; generator runs in-Worker via runGeneratorPass. The
// host acts through none of them — it presides and speaks (see guildOf).
//
// [LAW:one-source-of-truth] Persona records live in D1, not in an in-code
// registry. Prompt tuning and config adjustments happen via SQL without a
// redeploy.

import { asc, eq, gte } from 'drizzle-orm'
import { db } from '~/db/client'
import { personas, type DbPersona } from '~/db/schema'
import { AgentId, ProviderId, type TraitVector } from '~/lib/domain'
import { traitVectorSchema } from '~/lib/traits'
import { seedHash } from '~/lib/hash'
import { getProvider, mediumOf } from '~/providers'

export type PersonaRole = 'voter' | 'discoverer' | 'generator' | 'host'

// [LAW:types-are-the-program] The guilds of the city, one per role. `guildOf` is
// a TOTAL function over PersonaRole and the compile-time exhaustiveness gate for
// the role discriminator: adding a PersonaRole variant fails `tsc -b` at the
// `: never` arm below until its guild is declared — no wildcard/default swallows
// a new role. The Cast roster groups by this.
export type Guild = 'makers' | 'critics' | 'scavengers' | 'host'

// [LAW:dataflow-not-control-flow] The host's "does not execute" is not a skipped
// branch hiding in some executor — it is THIS explicit arm. Makers generate,
// critics vote, scavengers discover; each executor queries its own role literal,
// so role='host' is selected by no executor by construction. The host presides
// (seats spirits, crowns slops, names the dead, greets the living) — he runs no
// loop, and that is a property of the data model, not a guard.
export function guildOf(role: PersonaRole): Guild {
  switch (role) {
    case 'generator':
      return 'makers'
    case 'voter':
      return 'critics'
    case 'discoverer':
      return 'scavengers'
    case 'host':
      return 'host'
    default: {
      const _exhaustive: never = role
      return _exhaustive
    }
  }
}

// [LAW:types-are-the-program] [RECONCILE A] The persona is the first-class
// citizen entity. `agentId` is the stable internal id (origin reference, never
// in URLs); `handle` is the canonical human-readable URL key (/cast/:handle),
// `null` until minted (F9 owns minting the named-cast handles). The null is a
// real domain state — an un-minted citizen is not yet addressable — not a guard.
// The generator's MEDIUM (item 9) lives in `config` — it is generator-role
// tuning like the bias tables, not a column that would be meaningless for
// voters/discoverers (schema.ts: "no role-specific columns").
export type Persona = {
  agentId: AgentId
  handle: string | null
  displayName: string
  role: PersonaRole
  personaPrompt: string
  modelId: string
  config: Record<string, unknown>
  // [LAW:one-source-of-truth] The citizen's ONE sensibility vector (personas.traits) — the SAME
  // TraitVector that governs image composition, read by the voice layer via lib/register for speech
  // register. Parsed at this boundary; not a config_json key (it is a typed column with its own parser).
  traits: TraitVector
}

// [LAW:one-source-of-truth] The ONE resolver for a citizen's public creed — the
// single short line a visitor reads on the Cast surfaces. The full persona_prompt
// is the private character bible (the voice the composer/critic speaks through)
// and is NEVER shipped to the client. Every surface that shows a creed funnels
// through here.
//
// [LAW:dataflow-not-control-flow] The creed is an authored character ASSET when a
// citizen has one (config_json.creed — the makers' punchy lines, "Four steps.
// Never five."), and a prose slice of the prompt otherwise. The resolution is by
// DATA — creed present → use it; absent → slice — not a per-role special case: a
// critic simply has no creed key and falls through to the slice.
export function creedOf(persona: Pick<Persona, 'personaPrompt' | 'config'>): string {
  const authored = persona.config.creed
  return typeof authored === 'string' && authored.trim() !== ''
    ? authored.trim()
    : creedFromPrompt(persona.personaPrompt)
}

// The prose-slice fallback. The named-cast prompts open "You are <Name> — <creed>."
// or "Generator persona — <Name>, <creed>." (a single paragraph — so a naive
// first-LINE split would leak the whole bible). The slice takes the first SENTENCE
// of the body after that em-dash preamble; it falls back to the first sentence of
// the whole prompt when there is no em-dash. The guarantee is "never ship the
// bible," so the result is bounded three ways — first line, then first sentence,
// then a hard character cap — so a prompt with no sentence punctuation still cannot
// leak the body.
const CREED_MAX = 160

function creedFromPrompt(personaPrompt: string): string {
  const trimmed = personaPrompt.trim()
  const emDash = trimmed.indexOf('—')
  const body = (emDash === -1 ? trimmed : trimmed.slice(emDash + 1)).trim()
  const firstSentence = body.split('\n')[0].split(/(?<=[.!?])\s/)[0].trim()
  return firstSentence.length > CREED_MAX
    ? `${firstSentence.slice(0, CREED_MAX).trimEnd()}…`
    : firstSentence
}

// Returns [] when no personas match the role — the call site decides whether
// an empty pool is an error (action modules) or a no-op (orchestrator bootstrap).
// ORDER BY agent_id is the stability guarantee that makes pickPersona's
// hash-based index deterministic — SQLite/D1 row order is not stable without it.
export async function listPersonas(
  env: Env,
  role: PersonaRole,
): Promise<Persona[]> {
  const rows = await db(env)
    .select()
    .from(personas)
    .where(eq(personas.role, role))
    .orderBy(asc(personas.agentId))
  return rows.map(rowToPersona)
}

// [LAW:single-enforcer] The whole roster, every guild, for the Cast roll call.
// ORDER BY agent_id keeps the listing stable across reads; the caller groups by
// guildOf. Returns [] only on an empty city — a real state the roster renders.
export async function listAllPersonas(env: Env): Promise<Persona[]> {
  const rows = await db(env)
    .select()
    .from(personas)
    .orderBy(asc(personas.agentId))
  return rows.map(rowToPersona)
}

// The "blank-slate standing" window from the-roll-call.md — how long a freshly-born citizen reads as a
// NEWCOMER on the roll call ("everyone watching to see what they make"). A week serves the weekly-returning
// visitor who watches the city grow; born-today is too transient. A single tunable constant, not a mode.
export const NEWCOMER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

// [LAW:single-enforcer][LAW:locality-or-seam] The set of citizens BORN since a cutoff — newcomer-ness is a
// ROLL-CALL concern, so it lives at the seam that needs it (this focused read over personas.created_at),
// NOT as a field widened onto the shared Persona type that 17 indifferent consumers would carry. The
// caller derives `isNewcomer` by set membership. Returns a Set for O(1) lookup across the roster.
export async function newcomerAgentIds(env: Env, sinceMs: number): Promise<Set<string>> {
  const rows = await db(env)
    .select({ agentId: personas.agentId })
    .from(personas)
    .where(gte(personas.createdAt, new Date(sinceMs)))
  return new Set(rows.map((r) => r.agentId))
}

// [LAW:types-are-the-program] The city's first poet, resolved: just enough of the honored citizen for the
// rite to pronounce its decree (the name, the creed it weaves, the birth day the permanent mark records).
// A focused shape, not the shared Persona — the first-poet ceremony reads identity + birth time, nothing
// the rest of Persona carries.
export type VerseCitizen = {
  agentId: AgentId
  displayName: string
  creed: string
  bornAtMs: number
}

// [LAW:single-enforcer] The ONE answer to "who is the city's first poet?" — the EARLIEST generator citizen
// (by created_at) whose medium produces verse, or null when no verse-citizen exists yet. Verse-ness is
// DERIVED from the provider registry (mediumOf) at this read, the same single projection the generator
// composes by — never a stored "is-poet" flag, so the first-of-kind fact stays a pure function of state
// (the no-seed invariant). [LAW:dataflow-not-control-flow] the scan walks citizens oldest-first and the
// data decides the first verse one; an all-image city yields null, a real state the rite acts on (no decree).
export async function earliestVerseCitizen(env: Env): Promise<VerseCitizen | null> {
  const rows = await db(env)
    .select()
    .from(personas)
    .where(eq(personas.role, 'generator'))
    .orderBy(asc(personas.createdAt), asc(personas.agentId))
  for (const row of rows) {
    const persona = rowToPersona(row)
    // The provider the citizen authors through declares the medium it produces; resolving it through the
    // registry is the same single derivation the generator uses. A generator persona always carries a
    // medium (parseGeneratorConfig enforces it on write), so this read trusts that boundary.
    const provider = getProvider(ProviderId(String(persona.config.medium)))
    if (mediumOf(provider) === 'verse') {
      return {
        agentId: persona.agentId,
        displayName: persona.displayName,
        creed: creedOf(persona),
        bornAtMs: row.createdAt.getTime(),
      }
    }
  }
  return null
}

// [LAW:dataflow-not-control-flow] Deterministic pick: same (role, pool,
// scheduledTimeMs) → same persona. Uses FNV-1a hash seeded by the scheduled
// time — same pattern as chooseNextGeneration so firehose fires are
// reproducible. Returns null only when the pool is empty (bootstrap or
// misconfiguration), never throws on an empty pool.
export async function pickPersona(
  env: Env,
  role: PersonaRole,
  scheduledTimeMs: number,
): Promise<Persona | null> {
  const pool = await listPersonas(env, role)
  if (pool.length === 0) return null
  // [LAW:one-source-of-truth] The scheduled time + role combine by independent avalanche (hash.ts) —
  // no hand-built key whose correlation would depend on string position.
  const idx = seedHash(scheduledTimeMs, 'persona', role) % pool.length
  return pool[idx]
}

function rowToPersona(row: DbPersona): Persona {
  let config: Record<string, unknown>
  try {
    config = JSON.parse(row.configJson) as Record<string, unknown>
  } catch {
    throw new Error(
      `persona ${row.agentId}: config_json is malformed JSON — fix the row in D1`,
    )
  }
  // [LAW:no-silent-fallbacks] The traits column is a trust boundary (raw SQL / migration could write a
  // bad vector), so re-validate the four [0,1] axes here — a malformed traits_json fails loud, never a
  // laundered wrong-shape register. Mirrors the genome's traits_json read.
  const parsedTraits = traitVectorSchema.safeParse(JSON.parse(row.traitsJson))
  if (!parsedTraits.success) {
    throw new Error(`persona ${row.agentId}: traits_json failed validation — ${parsedTraits.error.message}`)
  }
  return {
    agentId: AgentId(row.agentId),
    handle: row.handle,
    displayName: row.displayName,
    role: row.role as PersonaRole,
    personaPrompt: row.personaPrompt,
    modelId: row.modelId,
    config,
    traits: parsedTraits.data,
  }
}

// [LAW:single-enforcer] Resolve a citizen by its internal agentId — the verdict path (the vote
// boundary) needs the speaker's identity + register to compose its utterance. Returns null on miss: a
// human voter (anon-cookie id, no persona row) is not a citizen and has no voice, so it utters nothing.
export async function getPersona(env: Env, agentId: string): Promise<Persona | null> {
  const rows = await db(env).select().from(personas).where(eq(personas.agentId, agentId)).limit(1)
  return rows.length === 0 ? null : rowToPersona(rows[0])
}

// [LAW:single-enforcer] Resolve a citizen by its canonical URL key. The /cast
// page and every handle-addressed surface funnel through here. Returns null on
// miss — the wire decides the 404 status; the reader does not throw on absence.
// The handle column's unique index guarantees at most one row.
export async function getPersonaByHandle(
  env: Env,
  handle: string,
): Promise<Persona | null> {
  const rows = await db(env)
    .select()
    .from(personas)
    .where(eq(personas.handle, handle))
    .limit(1)
  return rows.length === 0 ? null : rowToPersona(rows[0])
}

// [LAW:types-are-the-program] A newborn citizen — every column the personas table needs,
// minus createdAt (the writer stamps it). `handle` is NON-null here (a citizen is addressable
// from birth, unlike the migration-seeded rows that minted handles later) and `config`/`traits`
// are the typed shapes the row stores as JSON. The Birth Engine builds this; createPersona is the
// one writer that turns it into a row.
export type NewPersona = {
  agentId: AgentId
  handle: string
  displayName: string
  role: PersonaRole
  personaPrompt: string
  modelId: string
  config: Record<string, unknown>
  traits: TraitVector
}

// [LAW:single-enforcer] The only INSERT into the personas table — the Birth Engine writes new
// citizens through here, the same way updatePersonaConfig is the only config UPDATE. The agentId
// PK makes the daily birth idempotent BY CONSTRUCTION: onConflictDoNothing on a re-fire of an
// already-settled day writes nothing and RETURNING discriminates the outcome at the single
// statement — a returned row means THIS call created the citizen, an empty result means the day
// was already born (mirrors recordCrowning's UNIQUE(rite_day) idempotency). No check-then-insert
// TOCTOU. A handle collision is a UNIQUE-index violation that throws (loud) — the caller's
// distinctness pre-check makes it unreachable, but storage integrity still fails closed.
export async function createPersona(env: Env, p: NewPersona): Promise<{ created: boolean }> {
  const inserted = await db(env)
    .insert(personas)
    .values({
      agentId: p.agentId,
      handle: p.handle,
      displayName: p.displayName,
      role: p.role,
      personaPrompt: p.personaPrompt,
      modelId: p.modelId,
      configJson: JSON.stringify(p.config),
      traitsJson: JSON.stringify(p.traits),
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: personas.agentId })
    .returning({ agentId: personas.agentId })
  return { created: inserted.length > 0 }
}

// [LAW:single-enforcer] The only writer for persona config. All config updates
// (admin dashboard, future migration tooling) go through here so the JSON
// serialisation and the agentId lookup are enforced in one place.
export async function updatePersonaConfig(
  env: Env,
  agentId: AgentId,
  config: Record<string, unknown>,
): Promise<void> {
  await db(env)
    .update(personas)
    .set({ configJson: JSON.stringify(config) })
    .where(eq(personas.agentId, agentId))
}
