// SlopSpot Voter — homelab Nomad periodic job.
// Runs every 15m. Loads all voter personas, applies per-persona stochastic
// scheduler (expectedDailyFires in config_json), and runs passes for those due
// this tick. Exits 0 on success, non-zero on hard failures.

import { runVotingRound } from './pipeline.js'
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
  siteUrl: process.env['SLOPSPOT_SITE_URL'] ?? 'https://slopspot.ai',
  metricsEndpoint: process.env['VICTORIA_METRICS_ENDPOINT'] ?? 'http://192.168.7.208:8428/write',
}

const scheduledTime = new Date()

console.log('voter: starting round', { siteUrl: cfg.siteUrl, scheduledTime: scheduledTime.toISOString() })

try {
  await runVotingRound(cfg, scheduledTime)
  console.log('voter: round complete')
  process.exit(0)
} catch (err) {
  console.error('voter: fatal error', err)
  process.exit(1)
}
