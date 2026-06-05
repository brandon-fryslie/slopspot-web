// [LAW:one-source-of-truth] The staging env block in wrangler.jsonc is the single
// definition of staging bindings. This script reads that block, merges it over the
// Vite-compiled build/server/wrangler.json (which the @cloudflare/vite-plugin
// generates stripped of env blocks), and deploys the result. The wrangler.jsonc
// env block is the definition; this script is mechanical application.
//
// Usage: node scripts/deploy-staging.mjs [--skip-build]
//   --skip-build  Use the existing build/server/wrangler.json without rebuilding.

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const skipBuild = process.argv.includes('--skip-build')

if (!skipBuild) {
  console.log('Building…')
  execSync('pnpm run build', { cwd: root, stdio: 'inherit' })
}

// Read the compiled prod config (the definitive wrangler artifact from the build).
const compiledPath = resolve(root, 'build/server/wrangler.json')
const compiled = JSON.parse(readFileSync(compiledPath, 'utf8'))

// Read the staging env block from wrangler.jsonc.
// wrangler.jsonc uses JS comments — strip them with a minimal regex before JSON.parse.
const wranglerSrc = readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8')
const wranglerJson = JSON.parse(wranglerSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''))
const stagingEnv = wranglerJson.env?.staging
if (!stagingEnv) throw new Error('wrangler.jsonc has no env.staging block')

// Merge: start with the compiled config, apply staging overrides field by field.
// configPath / userConfigPath / definedEnvironments are build-system metadata that
// wrangler uses to locate the original source config. The staging deploy is
// self-contained — these fields would only confuse wrangler here.
const stagingConfig = {
  ...compiled,
  configPath: undefined,
  userConfigPath: undefined,
  topLevelName: undefined,
  definedEnvironments: [],
  legacy_env: undefined,
  name: `slopspot-web-staging`,
  vars: { ...compiled.vars, ...stagingEnv.vars },
  triggers: stagingEnv.triggers ?? { crons: [] },
  routes: stagingEnv.routes ?? [],
  workers_dev: stagingEnv.workers_dev ?? compiled.workers_dev,
  d1_databases: stagingEnv.d1_databases ?? compiled.d1_databases,
  r2_buckets: stagingEnv.r2_buckets ?? compiled.r2_buckets,
  kv_namespaces: stagingEnv.kv_namespaces ?? compiled.kv_namespaces,
  queues: stagingEnv.queues ?? compiled.queues,
}

// Remove undefined keys so wrangler doesn't choke on them.
const clean = Object.fromEntries(Object.entries(stagingConfig).filter(([, v]) => v !== undefined))

const tempPath = resolve(root, 'build/server/wrangler.staging.json')
writeFileSync(tempPath, JSON.stringify(clean, null, 2))

try {
  console.log('Deploying staging…')
  execSync(`wrangler deploy --config "${tempPath}"`, { cwd: root, stdio: 'inherit' })
} finally {
  unlinkSync(tempPath)
}
