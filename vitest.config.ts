import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

// [LAW:locality-or-seam] Test config is its own concern, kept off vite.config.ts.
// The build config there loads the Cloudflare/React-Router/Tailwind plugins to
// emit a Workers SSR bundle; the Cloudflare plugin crashes vitest's config
// resolution and none of them belong in a unit-test run. Vitest reads this file
// instead of vite.config.ts, so the two never entangle.
//
// This is the minimal harness: node env + the ~/* alias. foundation.3
// (slopspot-foundation-bux.3) extends it — happy-dom for component tests and the
// @cloudflare/vitest-pool-workers project for D1-backed integration tests.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
  },
})
