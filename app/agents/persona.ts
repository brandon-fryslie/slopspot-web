// [LAW:single-enforcer] The only module that reads/writes the personas table.
// All persona-driven actions (vote, discover, generate) obtain their persona
// via listPersonas or pickPersona — no direct D1 reads elsewhere.
//
// [LAW:types-are-the-program] PersonaRole is a closed discriminated union.
// Adding a new role is one variant here + one action module in the downstream
// ticket; tsc -b enforces the gap via the exhaustive switch in runAgentPass.
//
// [LAW:one-source-of-truth] Persona records live in D1, not in an in-code
// registry. Prompt tuning and config adjustments happen via SQL without a
// redeploy.

import { eq } from 'drizzle-orm'
import { db } from '~/db/client'
import { personas, type DbPersona } from '~/db/schema'
import { AgentId } from '~/lib/domain'

export type PersonaRole = 'voter' | 'discoverer' | 'generator'

export type Persona = {
  agentId: AgentId
  displayName: string
  role: PersonaRole
  personaPrompt: string
  modelId: string
  config: Record<string, unknown>
}

// [LAW:types-are-the-program] Returns null rather than throwing when no
// personas exist for the role — the call site decides whether an empty pool is
// an error (action modules) or a no-op (orchestrator bootstrap).
export async function listPersonas(
  env: Env,
  role: PersonaRole,
): Promise<Persona[]> {
  const rows = await db(env)
    .select()
    .from(personas)
    .where(eq(personas.role, role))
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
  return {
    agentId: AgentId(row.agentId),
    displayName: row.displayName,
    role: row.role as PersonaRole,
    personaPrompt: row.personaPrompt,
    modelId: row.modelId,
    config: JSON.parse(row.configJson) as Record<string, unknown>,
  }
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
