import { defineWorkspace } from 'vitest/config'

// [LAW:locality-or-seam] The smoke suite is a distinct test environment: it makes
// real network calls against a RUNNING server (prod for liveness, a dev deploy for
// writes). It must never run inside the default `pnpm test`, which auto-detects
// vitest.workspace.ts (node + workers projects) and has no live target. Passing
// THIS file via `vitest --workspace` overrides that auto-detection, so the smoke
// project runs in isolation — and the default test run never picks up smoke/.
export default defineWorkspace([
  {
    test: {
      name: 'smoke',
      environment: 'node',
      include: ['smoke/**/*.smoke.ts'],
      // Live HTTP round-trips (a breed does Haiku-fallback + mock provider + R2
      // ingest server-side) need headroom beyond vitest's 5s default.
      testTimeout: 30_000,
      hookTimeout: 30_000,
      // Network-bound; keep output legible by running one file at a time.
      fileParallelism: false,
    },
  },
])
