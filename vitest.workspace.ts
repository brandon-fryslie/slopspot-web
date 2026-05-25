import { defineWorkspace } from 'vitest/config'
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'
import { fileURLToPath } from 'url'

// [LAW:locality-or-seam] Two distinct test environments need two distinct
// projects. The node project is the existing unit test suite; it uses vitest's
// default node runner with the ~/* alias. The workers project runs inside a
// real workerd/miniflare isolate so tests can read/write actual R2 bindings
// rather than mocking them. Keeping them separate means neither project needs
// to understand the other's setup.
export default defineWorkspace([
  // Node project: all unit tests except the R2/D1 integration tests.
  // vitest.config.ts is the authoritative root options for this project.
  './vitest.config.ts',

  // Workers project: integration tests that need real bindings.
  // [LAW:one-source-of-truth] Only the MEDIA R2 bucket is declared here —
  // we don't load the full wrangler.jsonc to avoid pulling in the main Worker
  // (workers/app.ts) and its full dependency graph into the test isolate.
  //
  // resolve.alias is used instead of tsconfigPaths() because tsconfigPaths()
  // discovers tsconfigs by traversing the tsconfig.json reference graph, and
  // tsconfig.workers-test.json is a leaf that covers a different type env than
  // the rest of the graph. Using import.meta.url (proper ESM) avoids __dirname.
  defineWorkersProject({
    resolve: {
      alias: { '~': fileURLToPath(new URL('./app', import.meta.url)) },
    },
    test: {
      name: 'workers',
      include: [
        'app/storage/__tests__/**/*.test.ts',
        'app/routes/__tests__/**/*.test.ts',
      ],
      poolOptions: {
        workers: {
          miniflare: {
            compatibilityDate: '2026-05-17',
            compatibilityFlags: ['nodejs_compat'],
            r2Buckets: ['MEDIA'],
          },
          isolatedStorage: true,
        },
      },
    },
  }),
])
