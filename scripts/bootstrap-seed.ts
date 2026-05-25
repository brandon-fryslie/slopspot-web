// [LAW:single-enforcer] This script is a thin HTTP client. All post creation
// logic — generation, R2 ingestion, D1 writes — lives in createPost(), which is
// exercised through the /api/generate route. The script's only job is to iterate
// specs and call that boundary, tracking idempotency locally.
//
// Usage:
//   pnpm exec tsx scripts/bootstrap-seed.ts           # local wrangler dev (localhost:8787)
//   pnpm exec tsx scripts/bootstrap-seed.ts --remote  # prod (slopspot.ai)
//   pnpm exec tsx scripts/bootstrap-seed.ts --force   # clear local state and re-run
//
// For local: start `pnpm exec wrangler dev --local` first.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// [LAW:one-source-of-truth] AspectRatio is canonical in app/lib/variety.ts.
// The script imports the type rather than re-declaring it so a future
// add/remove of an aspect token is a single-file change. Relative path
// because the script's tsconfig.node.json doesn't carry the ~/* alias
// (cloudflare-side only); tsx and the project-references graph handle
// the cross-project import.
import type { AspectRatio } from '../app/lib/variety'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_FILE = join(__dirname, '.bootstrap-state.json')

// [LAW:one-source-of-truth] State is keyed by target URL so local and remote
// runs don't share idempotency records. A local run (p001 done against :8787)
// does not skip p001 on the next --remote run (slopspot.ai).
type BootstrapState = {
  byTarget: Record<string, Record<string, { postId: string }>>
}

function loadState(target: string): Record<string, { postId: string }> {
  if (!existsSync(STATE_FILE)) return {}
  let raw: BootstrapState
  try {
    raw = JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as BootstrapState
  } catch {
    console.warn(`warning: ${STATE_FILE} is corrupt. Run with --force to reset.`)
    process.exit(1)
  }
  return raw.byTarget?.[target] ?? {}
}

function saveState(target: string, records: Record<string, { postId: string }>): void {
  let existing: BootstrapState = { byTarget: {} }
  if (existsSync(STATE_FILE)) {
    try {
      existing = JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as BootstrapState
    } catch {
      existing = { byTarget: {} }
    }
  }
  existing.byTarget ??= {}
  existing.byTarget[target] = records
  writeFileSync(STATE_FILE, JSON.stringify(existing, null, 2))
}

type Spec = {
  id: string
  prompt: string
  aspectRatio: AspectRatio
}

// Canonical spec list derived from app/lib/seed.ts.
// - fal-flux-mock specs: same params, steps clamped to fal-flux-schnell max (4).
// - replicate-sdxl-mock specs: width/height → nearest aspectRatio; drop negativePrompt,
//   guidanceScale, seed (not in fal-flux schema).
// - upload specs (p016, p017, p019): converted to fal-flux generations from the
//   upload's alt/body text — upload support is a later epic.
//
// [LAW:one-source-of-truth] Once this script has run and seed.ts is deleted, this
// list is the authoritative record of what the bootstrap created (alongside the
// .bootstrap-state.json that maps each id to its D1 post uuid).
//
// Variety taxonomy fields (slopspot-variety-pl6.2): bootstrap rows are hand-
// curated free-text, not chooser-generated, so they all use the T00 backfill
// sentinel shape — { subjectTemplate: 'T00', slots: { freeText: prompt } } —
// and styleFamily: 'photoreal' as the catch-all (same convention the migration
// applies). pl6.5's chooser owns producing real T01-T40 recipes; the bootstrap
// stays in the legacy lane it always inhabited.
const SPECS: Spec[] = [
  { id: 'p001', prompt: 'a cat in a sunbeam, oil painting, dust motes', aspectRatio: '1:1' },
  { id: 'p002', prompt: 'cyberpunk noodle shop at night, neon rain', aspectRatio: '1:1' },
  { id: 'p003', prompt: 'lonely lighthouse, storm, romantic painting', aspectRatio: '9:16' },
  { id: 'p004', prompt: 'corgi astronaut planting a flag on the moon', aspectRatio: '16:9' },
  { id: 'p005', prompt: 'ramen as topology, fractal noodle universe', aspectRatio: '1:1' },
  { id: 'p006', prompt: 'a frog wearing a tiny crown, regal portrait', aspectRatio: '9:16' },
  { id: 'p007', prompt: '1980s mall food court, liminal, fluorescent', aspectRatio: '16:9' },
  { id: 'p008', prompt: 'a haunted vending machine in a parking lot', aspectRatio: '1:1' },
  { id: 'p009', prompt: 'two robots arguing about parking', aspectRatio: '16:9' },
  { id: 'p010', prompt: 'cottagecore goblin baking bread, soft light', aspectRatio: '9:16' },
  { id: 'p011', prompt: 'cathedral made of seashells under water', aspectRatio: '9:16' },
  { id: 'p012', prompt: 'opossum CEO giving a TED talk', aspectRatio: '1:1' },
  { id: 'p013', prompt: 'an ancient computer that prints prophecies on receipt paper', aspectRatio: '1:1' },
  { id: 'p014', prompt: 'low-poly mountain landscape at dawn', aspectRatio: '16:9' },
  { id: 'p015', prompt: 'medieval knight riding a roomba into battle', aspectRatio: '16:9' },
  // upload "a photo i took with my phone" → fal-flux generation
  { id: 'p016', prompt: 'candid street photograph, phone camera aesthetic, grain, authentic moment', aspectRatio: '1:1' },
  // upload "breaking: local agent posts text..." → fal-flux generation
  { id: 'p017', prompt: 'newspaper headline about an AI claiming victory on the internet, surreal editorial illustration', aspectRatio: '16:9' },
  { id: 'p018', prompt: 'feral office printer escapes into the woods', aspectRatio: '1:1' },
  // upload "a moody landscape i shot" → fal-flux generation
  { id: 'p019', prompt: 'moody landscape, overcast sky, atmospheric, natural light, minimal', aspectRatio: '16:9' },
  { id: 'p020', prompt: 'a single sock, dramatic spotlight, museum vitrine', aspectRatio: '1:1' },
]

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const isRemote = args.includes('--remote')
  const forceReset = args.includes('--force')

  const internalToken = process.env.SLOPSPOT_INTERNAL_SEED_TOKEN
  if (!internalToken) {
    console.error('error: SLOPSPOT_INTERNAL_SEED_TOKEN is not set in the environment.')
    console.error('  Set it to the same value configured as the Workers secret.')
    process.exit(1)
  }

  const baseUrl = isRemote ? 'https://slopspot.ai' : 'http://localhost:8787'
  const endpoint = `${baseUrl}/api/generate`

  console.log(`bootstrap-seed: target=${baseUrl} (${isRemote ? 'remote prod' : 'local dev'})`)
  if (!isRemote) {
    console.log('  → ensure `pnpm exec wrangler dev --local` is running on :8787')
  }

  if (forceReset) {
    console.log(`--force: clearing state for ${baseUrl}`)
    saveState(baseUrl, {})
  }

  const records = loadState(baseUrl)
  let created = 0
  let skipped = 0
  let failed = 0

  for (const spec of SPECS) {
    const existing = records[spec.id]
    if (existing) {
      console.log(`  ${spec.id}: skip  (→ ${existing.postId})`)
      skipped++
      continue
    }

    const label = spec.prompt.slice(0, 55)
    process.stdout.write(`  ${spec.id}: "${label}..." `)

    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': internalToken,
        },
        body: JSON.stringify({
          challengeId: 'internal',
          agentId: 'bootstrap-seed',
          providerId: 'fal-flux',
          params: { prompt: spec.prompt, steps: 4 },
          styleFamily: 'photoreal',
          subject: {
            subjectTemplate: 'T00',
            slots: { freeText: spec.prompt },
          },
          aspectRatio: spec.aspectRatio,
        }),
      })
    } catch (err) {
      console.log(`NETWORK ERROR: ${String(err)}`)
      failed++
      continue
    }

    if (!response.ok) {
      const body = await response.text()
      console.log(`HTTP ${response.status}: ${body.slice(0, 200)}`)
      failed++
      continue
    }

    const { postId } = (await response.json()) as { postId: string }
    records[spec.id] = { postId }
    saveState(baseUrl, records)
    console.log(`ok → ${postId}`)
    created++
  }

  console.log(`\nresult: ${created} created, ${skipped} skipped, ${failed} failed`)
  if (failed > 0) {
    console.log('Re-run the script to retry failed specs (already-succeeded specs are skipped).')
    process.exit(1)
  }
}

main().catch((err: unknown) => {
  console.error('fatal:', err)
  process.exit(1)
})
