// [LAW:single-enforcer] One function that turns the raw D1 binding into a
// typed Drizzle client. Every read/write in the app goes through this — no
// other module touches env.DB directly. The schema object is bound here so
// callers get full type inference (db.select().from(posts), etc.) without
// passing the schema themselves.

import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import * as schema from './schema'

export type DB = DrizzleD1Database<typeof schema>

export function db(env: Env): DB {
  return drizzle(env.DB, { schema })
}
