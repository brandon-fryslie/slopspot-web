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

import { asc, eq } from 'drizzle-orm'
import { db } from '~/db/client'
import { personas, type DbPersona } from '~/db/schema'
import { AgentId } from '~/lib/domain'

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
}

// [LAW:one-source-of-truth] The ONE derivation of a citizen's public creed from
// its persona_prompt. The full prompt is the private character bible (the voice
// the composer/critic speaks through) and is NEVER shipped to the client; the
// creed is the single short line a visitor reads on the Cast surfaces. Every
// surface that shows a creed funnels through here so the "no raw prompt dump"
// rule holds in one place rather than being re-implemented (and drifting) per
// route.
//
// The named-cast prompts open "You are <Name> — <creed>." or "Generator persona
// — <Name>, <creed>." (a single paragraph — so a naive first-LINE split would
// leak the whole bible). The creed is the first SENTENCE of the body after that
// em-dash preamble: the self-description the character leads with. Falls back to
// the first sentence of the whole prompt when there is no em-dash.
//
// The guarantee is "never ship the bible," so the result is bounded three ways —
// first line, then first sentence, then a hard character cap. A prompt with no
// sentence punctuation (comma-only, one long run-on) still cannot leak the body:
// the cap clips it to a single line of text with an ellipsis.
const CREED_MAX = 160

export function creedOf(personaPrompt: string): string {
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
  const idx = fnv1a32(`persona:${role}:${scheduledTimeMs}`) % pool.length
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
  return {
    agentId: AgentId(row.agentId),
    handle: row.handle,
    displayName: row.displayName,
    role: row.role as PersonaRole,
    personaPrompt: row.personaPrompt,
    modelId: row.modelId,
    config,
  }
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

// [LAW:one-source-of-truth] FNV-1a hash — same implementation as the firehose
// chooser. Duplicated here (not shared) because both modules are independently
// pure with no common dep; extracting to a shared util would create coupling
// for a 7-line function.
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}
