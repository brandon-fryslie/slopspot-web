import { configDefaults, defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// [LAW:locality-or-seam] Test config is its own concern, kept off vite.config.ts.
// The build config there loads the Cloudflare/React-Router/Tailwind plugins to
// emit a Workers SSR bundle; the Cloudflare plugin crashes vitest's config
// resolution and none of them belong in a unit-test run. Vitest reads this file
// instead of vite.config.ts, so the two never entangle.
//
// Multi-project setup lives in vitest.workspace.ts which adds the
// @cloudflare/vitest-pool-workers project for R2/D1-backed integration tests.
// This file remains the root config: node environment for unit tests, and the
// ~/* path alias. The workspace file excludes these node tests from the workers
// project automatically via per-project include globs.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    exclude: [
      ...configDefaults.exclude,
      // Workers integration tests require miniflare — they live in a separate
      // workspace project (see vitest.workspace.ts).
      'app/storage/__tests__/**',
      'app/routes/__tests__/**',
    ],
  },
})
