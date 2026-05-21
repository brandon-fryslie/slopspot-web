// [LAW:one-source-of-truth] drizzle-kit configuration. The schema in
// app/db/schema.ts is the source; migrations in drizzle/ are the residue.
// Dialect is `sqlite` (D1 is SQLite at the wire level). No `driver` is set:
// drizzle-kit is only ever used here for `generate`, which diffs the schema
// and emits SQL without a DB connection. Migrations are applied by
// `wrangler d1 migrations apply`, not drizzle-kit — so the d1-http driver
// and its credentials are not needed.

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './app/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
})
