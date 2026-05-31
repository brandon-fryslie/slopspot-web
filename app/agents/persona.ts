// [LAW:single-enforcer] The only module that reads/writes the personas table.
// All persona-driven actions (vote, discover, generate) obtain their persona
// via listPersonas or pickPersona — no direct D1 reads elsewhere.
//
// [LAW:types-are-the-program] PersonaRole is a closed discriminated union.
// Each role's executor lives wherever that role runs: voter and discoverer are
// homelab Nomad services (services/voter, services/discoverer) that read these
// rows over the D1 REST API; generator runs in-Worker via runGeneratorPass.
//
// [LAW:one-source-of-truth] Persona records live in D1, not in an in-code
// registry. Prompt tuning and config adjustments happen via SQL without a
// redeploy.

import { asc, eq } from 'drizzle-orm'
import { db } from '~/db/client'
import { personas, type DbPersona } from '~/db/schema'
import { AgentId } from '~/lib/domain'

export type PersonaRole = 'voter' | 'discoverer' | 'generator'

// [LAW:types-are-the-program] [RECONCILE A] The persona is the first-class
// citizen entity. `agentId` is the stable internal id (origin reference, never
// in URLs); `handle` is the canonical human-readable URL key (/cast/:handle).
// The generator's MEDIUM (item 9) lives in `config` — it is generator-role
// tuning like the bias tables, not a column that would be meaningless for
// voters/discoverers (schema.ts: "no role-specific columns").
export type Persona = {
  agentId: AgentId
  handle: string
  displayName: string
  role: PersonaRole
  personaPrompt: string
  modelId: string
  config: Record<string, unknown>
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
