// [LAW:single-enforcer] The one place that decides whether the firehose may
// spend. Every generator that costs money — the minimal cron, the future
// variety chooser — consults checkBudget() and must not re-derive the
// spent-vs-ceiling comparison, or the two will drift into different caps.
//
// [LAW:one-source-of-truth] The ceiling is a reviewed code constant, not an env
// binding: a budget kill switch you can grep, diff, and reason about belongs in
// version control, not in a runtime value an accidental deploy could blank.
// Per-call cost is owned by each provider's capabilities (the registry), so
// spend is derived, never a second stored quantity that could fall out of sync.

import { eq, gte, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { generations, posts } from '~/db/schema'
import { getProvider } from '~/providers'
import { ProviderId } from '~/lib/domain'

export const DAILY_BUDGET_USD = 1.0

const WINDOW_MS = 24 * 60 * 60 * 1000

// [LAW:types-are-the-program] Money is an integer count of a minimal unit, not a
// real number — 0.003 USD has no exact binary float, so float sums drift and a
// strict cap comparison could flip at the boundary. Dollar floats are the
// ergonomic input (providers declare costEstimateUsd: 0.003); they are quantized
// to integer micro-USD once, here at the boundary, so all spend arithmetic and
// the cap comparison are exact. spentUsd is converted back only for display.
const USD_TO_MICROS = 1_000_000
const toMicros = (usd: number): number => Math.round(usd * USD_TO_MICROS)

export type BudgetStatus = {
  withinBudget: boolean
  spentUsd: number
  ceilingUsd: number
}

// [LAW:types-are-the-program] Pure: a map of provider-calls plus a ceiling fully
// determines the verdict. Splitting this from the D1 query is the test seam —
// the synthetic "$0 ceiling denies" proof runs here with no database. The cap is
// strict (spent < ceiling), so a $0 ceiling denies everything and hitting the
// ceiling exactly stops the next call.
// [LAW:no-silent-fallbacks] getProvider throws on an unknown id: a generation
// whose provider the registry can't price is an inconsistency, not a free call.
export function evaluateBudget(
  callsByProvider: Map<ProviderId, number>,
  ceilingUsd: number = DAILY_BUDGET_USD,
): BudgetStatus {
  let spentMicros = 0
  for (const [providerId, calls] of callsByProvider) {
    spentMicros += toMicros(getProvider(providerId).capabilities.costEstimateUsd) * calls
  }
  return {
    withinBudget: spentMicros < toMicros(ceilingUsd),
    spentUsd: spentMicros / USD_TO_MICROS,
    ceilingUsd,
  }
}

// [LAW:types-are-the-program] generations' own timestamps are cleared on status
// transition by the schema CHECK, so none is reliably present; posts.created_at
// is written in the same transaction as the generation (createPost) and always
// is. One call == one generations row, so COUNT per provider is the call count.
async function callsLast24h(env: Env, since: Date): Promise<Map<ProviderId, number>> {
  const rows = await db(env)
    .select({ providerId: generations.providerId, calls: sql<number>`count(*)` })
    .from(generations)
    .innerJoin(posts, eq(posts.id, generations.postId))
    .where(gte(posts.createdAt, since))
    .groupBy(generations.providerId)
  return new Map(rows.map((r) => [ProviderId(r.providerId), r.calls]))
}

export async function checkBudget(
  env: Env,
  ceilingUsd: number = DAILY_BUDGET_USD,
  now: number = Date.now(),
): Promise<BudgetStatus> {
  return evaluateBudget(await callsLast24h(env, new Date(now - WINDOW_MS)), ceilingUsd)
}
