// [LAW:one-source-of-truth] drizzle-kit configuration. The schema in
// app/db/schema.ts is the source; migrations in drizzle/ are the residue.
// We use the `sqlite` dialect (D1 is SQLite at the wire level) and the
// `d1-http` driver tag so drizzle-kit emits SQL that wrangler's d1
// migrations runner accepts.

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './app/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
})
