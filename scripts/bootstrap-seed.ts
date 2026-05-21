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

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_FILE = join(__dirname, '.bootstrap-state.json')

type BootstrapState = {
  bootstrapped: Record<string, { postId: string; createdAt: string }>
}

function loadState(): BootstrapState {
  if (!existsSync(STATE_FILE)) return { bootstrapped: {} }
  return JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as BootstrapState
}

function saveState(state: BootstrapState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

type Spec = {
  id: string
  params: { prompt: string; aspectRatio: '1:1' | '16:9' | '9:16'; steps: number }
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
const SPECS: Spec[] = [
  { id: 'p001', params: { prompt: 'a cat in a sunbeam, oil painting, dust motes', aspectRatio: '1:1', steps: 4 } },
  // replicate-sdxl-mock 1024x1024 → 1:1
  { id: 'p002', params: { prompt: 'cyberpunk noodle shop at night, neon rain', aspectRatio: '1:1', steps: 4 } },
  { id: 'p003', params: { prompt: 'lonely lighthouse, storm, romantic painting', aspectRatio: '9:16', steps: 4 } },
  // replicate-sdxl-mock 1280x720 → 16:9
  { id: 'p004', params: { prompt: 'corgi astronaut planting a flag on the moon', aspectRatio: '16:9', steps: 4 } },
  { id: 'p005', params: { prompt: 'ramen as topology, fractal noodle universe', aspectRatio: '1:1', steps: 4 } },
  // replicate-sdxl-mock 768x1024 → 9:16 (portrait closest)
  { id: 'p006', params: { prompt: 'a frog wearing a tiny crown, regal portrait', aspectRatio: '9:16', steps: 4 } },
  { id: 'p007', params: { prompt: '1980s mall food court, liminal, fluorescent', aspectRatio: '16:9', steps: 4 } },
  // replicate-sdxl-mock 1024x1024 → 1:1
  { id: 'p008', params: { prompt: 'a haunted vending machine in a parking lot', aspectRatio: '1:1', steps: 4 } },
  { id: 'p009', params: { prompt: 'two robots arguing about parking', aspectRatio: '16:9', steps: 4 } },
  // replicate-sdxl-mock 896x1152 → 9:16 (portrait closest)
  { id: 'p010', params: { prompt: 'cottagecore goblin baking bread, soft light', aspectRatio: '9:16', steps: 4 } },
  { id: 'p011', params: { prompt: 'cathedral made of seashells under water', aspectRatio: '9:16', steps: 4 } },
  // replicate-sdxl-mock 1024x1024 → 1:1
  { id: 'p012', params: { prompt: 'opossum CEO giving a TED talk', aspectRatio: '1:1', steps: 4 } },
  { id: 'p013', params: { prompt: 'an ancient computer that prints prophecies on receipt paper', aspectRatio: '1:1', steps: 4 } },
  // replicate-sdxl-mock 1280x720 → 16:9
  { id: 'p014', params: { prompt: 'low-poly mountain landscape at dawn', aspectRatio: '16:9', steps: 4 } },
  { id: 'p015', params: { prompt: 'medieval knight riding a roomba into battle', aspectRatio: '16:9', steps: 4 } },
  // upload "a photo i took with my phone" → fal-flux generation
  { id: 'p016', params: { prompt: 'candid street photograph, phone camera aesthetic, grain, authentic moment', aspectRatio: '1:1', steps: 4 } },
  // upload "breaking: local agent posts text..." → fal-flux generation
  { id: 'p017', params: { prompt: 'newspaper headline about an AI claiming victory on the internet, surreal editorial illustration', aspectRatio: '16:9', steps: 4 } },
  // replicate-sdxl-mock 1024x1024 → 1:1
  { id: 'p018', params: { prompt: 'feral office printer escapes into the woods', aspectRatio: '1:1', steps: 4 } },
  // upload "a moody landscape i shot" → fal-flux generation
  { id: 'p019', params: { prompt: 'moody landscape, overcast sky, atmospheric, natural light, minimal', aspectRatio: '16:9', steps: 4 } },
  { id: 'p020', params: { prompt: 'a single sock, dramatic spotlight, museum vitrine', aspectRatio: '1:1', steps: 4 } },
]

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const isRemote = args.includes('--remote')
  const forceReset = args.includes('--force')

  const baseUrl = isRemote ? 'https://slopspot.ai' : 'http://localhost:8787'
  const endpoint = `${baseUrl}/api/generate`

  console.log(`bootstrap-seed: target=${baseUrl} (${isRemote ? 'remote prod' : 'local dev'})`)
  if (!isRemote) {
    console.log('  → ensure `pnpm exec wrangler dev --local` is running on :8787')
  }

  if (forceReset) {
    console.log('--force: clearing local state')
    saveState({ bootstrapped: {} })
  }

  const state = loadState()
  let created = 0
  let skipped = 0
  let failed = 0

  for (const spec of SPECS) {
    const existing = state.bootstrapped[spec.id]
    if (existing) {
      console.log(`  ${spec.id}: skip  (→ ${existing.postId})`)
      skipped++
      continue
    }

    const label = spec.params.prompt.slice(0, 55)
    process.stdout.write(`  ${spec.id}: "${label}..." `)

    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: 'fal-flux', params: spec.params }),
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

    const post = (await response.json()) as { id: string; createdAt: string }
    state.bootstrapped[spec.id] = { postId: post.id, createdAt: post.createdAt }
    saveState(state)
    console.log(`ok → ${post.id}`)
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
