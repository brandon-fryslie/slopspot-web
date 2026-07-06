// [LAW:single-enforcer] One function that turns the raw D1 binding into a
// typed Drizzle client. Every domain read/write goes through this. The one
// documented exception is app/lib/quota.ts, which uses env.DB directly for a
// two-statement atomic D1 batch that drizzle's batch() cannot express with raw
// SQL SQLWrapper objects. The schema object is bound here so callers get full
// type inference (db.select().from(posts), etc.) without passing the schema.

import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import * as schema from './schema'

export type DB = DrizzleD1Database<typeof schema>

// [LAW:types-are-the-program] The parameter states the true requirement — only the D1
// binding — so a Worker whose Env is narrower than the main app's (the cpu-tail consumer
// has just DB) calls through this same single enforcer without a cast.
export function db(env: Pick<Env, 'DB'>): DB {
  return drizzle(env.DB, { schema })
}
