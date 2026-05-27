// [LAW:single-enforcer] One place applies D1 migrations for the workers test
// project. With miniflare's `isolatedStorage: true`, the schema established in
// beforeAll persists across a test file's tests while data writes get rolled
// back per-test — so we get a fresh DB shape every test without re-applying
// migrations between them.
//
// [LAW:one-source-of-truth] env.TEST_MIGRATIONS is populated by
// readD1Migrations('./drizzle') in vitest.workspace.ts — the same migration
// files `wrangler d1 migrations apply` runs in dev/prod. There is no parallel
// "test schema" definition.

import { applyD1Migrations, env } from 'cloudflare:test'
import { beforeAll } from 'vitest'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[]
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
})
