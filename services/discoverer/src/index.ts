// SlopSpot Discoverer — homelab Nomad periodic job.
// Reads discoverer personas from D1, runs the discovery pipeline for each,
// and submits found AI-art candidates to slopspot.ai/api/found.
//
// Invoked by the Nomad periodic job every 12h. Exits 0 on success, non-zero
// on hard failures (missing env, D1 unreachable, etc.). Individual persona
// failures are logged but do not cause a non-zero exit.

import { runDiscoveryRound } from './pipeline.js'
import type { VisionProvider } from './zai.js'

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Required env var ${name} is not set`)
  return val
}

const rawProvider = process.env['VISION_PROVIDER'] ?? 'zai'
if (rawProvider !== 'zai' && rawProvider !== 'openai') {
  throw new Error(`Invalid VISION_PROVIDER: "${rawProvider}". Must be "zai" or "openai"`)
}
const visionProvider: VisionProvider = rawProvider
const visionApiKey =
  visionProvider === 'openai'
    ? requireEnv('OPENAI_API_KEY')
    : requireEnv('SLOPSPOT_ZAI_API_KEY')

const cfg = {
  d1: {
    apiToken: requireEnv('CLOUDFLARE_API_TOKEN'),
    accountId: requireEnv('CLOUDFLARE_ACCOUNT_ID'),
    databaseId: requireEnv('CLOUDFLARE_D1_DATABASE_ID'),
  },
  vision: { provider: visionProvider, apiKey: visionApiKey },
  foundEndpoint: process.env['SLOPSPOT_FOUND_ENDPOINT'] ?? 'https://slopspot.ai/api/found',
  metricsEndpoint:
    process.env['VICTORIA_METRICS_ENDPOINT'] ?? 'http://192.168.7.208:8428/write',
}

console.log('discoverer: starting round', {
  foundEndpoint: cfg.foundEndpoint,
  metricsEndpoint: cfg.metricsEndpoint,
})

try {
  await runDiscoveryRound(cfg)
  console.log('discoverer: round complete')
  process.exit(0)
} catch (err) {
  console.error('discoverer: fatal error', err)
  process.exit(1)
}
