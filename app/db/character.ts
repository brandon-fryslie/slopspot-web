// [LAW:one-source-of-truth] The DERIVED read of a citizen's ACCRETED character — its effective voice
// traits read from its act history (the genome slops it has blessed/buried), the same way feudStanding
// is read from shared votes and score is read as SUM(votes). There is NO stored personality blob: the
// accretion is a pure function (app/lib/character) of the acts this fetches. Mirrors feudStandingBetween:
// a thin D1 reader feeding a pure classifier. (slopspot-voice-w2v.3)

import { eq } from 'drizzle-orm'
import type { DB } from '~/db/client'
import { generations, votes } from '~/db/schema'
import { accreteCharacter, type CharacterAct } from '~/lib/character'
import { traitVectorSchema } from '~/lib/traits'
import type { TraitVector, VoteValue } from '~/lib/domain'

// [LAW:types-are-the-program] 14 days. A voice changes over a RUN of acts, not one — a slow half-life
// means a streak of verdicts shifts a citizen's tone while a single vote barely moves it. Symmetric with
// genome .7's FITNESS half-life (~10d): both consume the one recencyWeight leaf, each at its OWN rate at
// its own edge. A tunable edge constant — the .3 voice rate — set here where the accretion is applied.
export const VOICE_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000

// [LAW:single-enforcer] A citizen's acts: every GENERATION slop it voted on, paired with that slop's
// genome vector. The inner join to generations IS the exclusion of found/upload slops — they have no
// generations row and so contribute no genome vector, by construction rather than a filter. The traits
// re-validate at the D1 read boundary (raw SQL or a migration could write a bad vector), the same loud
// parse persona reads use — never a laundered wrong-shape register. [LAW:no-silent-fallbacks]
export async function characterActs(database: DB, citizen: string): Promise<CharacterAct[]> {
  const rows = await database
    .select({
      traitsJson: generations.traitsJson,
      value: votes.value,
      createdAt: votes.createdAt,
    })
    .from(votes)
    .innerJoin(generations, eq(generations.postId, votes.postId))
    .where(eq(votes.voterId, citizen))

  return rows.map((row) => ({
    traits: traitVectorSchema.parse(JSON.parse(row.traitsJson)),
    // [LAW:single-enforcer] the votes_value_shape CHECK is the sole enforcer of value ∈ {−1, 1}; this
    // reader trusts it the way feudStandingBetween trusts it when summing dispositions in SQL.
    value: row.value as VoteValue,
    createdAt: row.createdAt,
  }))
}

// [LAW:single-enforcer] base + the accreted pull of the record = the citizen's effective voice traits at
// `now`. The verdict seam (app/agents/verdict.ts) threads this into the PersonaRef that utter() speaks
// through; traitBias then renders the SAME register tinted by the past — no parallel register, no new
// code path. `now` is the caller's, so the projection stays deterministic.
export async function effectiveTraits(
  database: DB,
  citizen: string,
  base: TraitVector,
  now: Date,
): Promise<TraitVector> {
  const acts = await characterActs(database, citizen)
  return accreteCharacter(base, acts, now, VOICE_HALF_LIFE_MS)
}
