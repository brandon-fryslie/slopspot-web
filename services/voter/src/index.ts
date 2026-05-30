// SlopSpot Voter — homelab Nomad periodic job.
// Reads voter personas from D1, fetches the slopspot.ai feed, judges each
// candidate image via z.ai vision, and POSTs votes to slopspot.ai/api/posts/:id/vote.
//
// Invoked by the Nomad periodic job every 4h. Exits 0 on success, non-zero
// on hard failures (missing env, D1 unreachable, etc.). Individual persona
// failures are logged but do not cause a non-zero exit.

import { runVotingRound } from './pipeline.js'

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) throw new Error(`Required env var ${name} is not set`)
  return val
}

const cfg = {
  d1: {
    apiToken: requireEnv('CLOUDFLARE_API_TOKEN'),
    accountId: requireEnv('CLOUDFLARE_ACCOUNT_ID'),
    databaseId: requireEnv('CLOUDFLARE_D1_DATABASE_ID'),
  },
  zaiApiKey: requireEnv('SLOPSPOT_ZAI_API_KEY'),
  siteUrl: process.env['SLOPSPOT_SITE_URL'] ?? 'https://slopspot.ai',
  metricsEndpoint: process.env['VICTORIA_METRICS_ENDPOINT'] ?? 'http://192.168.7.208:8428/write',
}

console.log('voter: starting round', { siteUrl: cfg.siteUrl })

try {
  await runVotingRound(cfg)
  console.log('voter: round complete')
  process.exit(0)
} catch (err) {
  console.error('voter: fatal error', err)
  process.exit(1)
}
