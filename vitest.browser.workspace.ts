import { defineWorkspace } from 'vitest/config'
import { fileURLToPath } from 'url'

// [LAW:locality-or-seam] The scroll guard is a distinct test environment: it runs in a REAL headless
// browser (Chromium via Playwright) so it can drive the actual IntersectionObserver + fetch + Date
// revival the Workers vitest pool and the node unit project cannot. It must never run inside the
// default `pnpm test` (which auto-detects vitest.workspace.ts: node + workers). Passing THIS file via
// `vitest --workspace` overrides that auto-detection, so the browser project runs in isolation — same
// isolation discipline as vitest.smoke.workspace.ts.
export default defineWorkspace([
  {
    // [LAW:one-source-of-truth] Resolve ~/* with an explicit alias (the same pattern the workers
    // project uses in vitest.workspace.ts) rather than vite-tsconfig-paths: the browser test file is
    // excluded from the referenced tsconfig graph (it owns tsconfig.browser-test.json, which is not a
    // root reference), so tsconfig-path discovery would not cover it. An alias is unambiguous.
    resolve: {
      alias: { '~': fileURLToPath(new URL('./app', import.meta.url)) },
    },
    // sortModeUrlQuery pulls drizzle-orm into the client bundle (same as home.tsx's client bundle).
    // Pre-bundle it so the browser project doesn't optimize-then-reload mid-run (a flake source).
    optimizeDeps: { include: ['drizzle-orm'] },
    test: {
      name: 'browser',
      include: ['app/**/*.browser.test.tsx'],
      browser: {
        enabled: true,
        provider: 'playwright',
        headless: true,
        name: 'chromium',
        // The prober reads the JSON verdict, never a PNG; a failure screenshot is just litter in the
        // tree. [LAW:no-silent-failure] the red test IS the signal — no artifact to misread.
        screenshotFailures: false,
      },
    },
  },
])
