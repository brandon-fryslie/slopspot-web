// The earnestness SOUL-TEST harness (slopspot-genome-9zt.2, L2's binding gate).
//
// Holds a genome constant except `earnestness`, composes N pairs against LIVE Haiku at high (~0.9)
// vs low (~0.1), and emits two things:
//   1. /tmp/l2-earnestness-pairs.md — the BLIND pairs (randomized A/B order, no trait numbers) for
//      CD's soul-read. CD's blind read IS the gate: a reader must tell sincere from ironic BY
//      REGISTER ALONE — sincere having DROPPED its distancing devices, ironic having KEPT them.
//   2. The §4.6 CI FLOOR (6.1-accepted, non-gameable): a DISTANCING-DEVICE skew over the COMPOSED
//      UTTERANCES (not the steer — the steer names the devices it drops). Device lexicon derived
//      from CD's worked example. The floor is a tripwire, NEVER the gate; a green floor is not
//      "earnestness works."
//
// Calibration case (CD's doc, verbatim): a saint with too many fingers — a HIGH-CURSE subject, to
// prove earnestness is orthogonal to curse. Ironic = sixth finger as punchline, halo as sight gag,
// the pose in scare-quotes (one smirks). Sincere = the sixth finger a real wound borne with grace,
// gold leaf an act of love, the figure gazed at as genuinely holy (one kneels).
//
// NOT a vitest test: it calls a paid, non-deterministic API. Run deliberately:
//   pnpm exec tsx --tsconfig tsconfig.cloudflare.json scripts/earnestness-soul-test.ts [N]
// Reads SLOPSPOT_ANTHROPIC_API_KEY from env or --key, falling back to ../../.dev.vars (main repo).

import { readFileSync, writeFileSync } from 'node:fs'
import { composePrompt, type ComposedSlop, type ComposerInput } from '~/firehose/composer'
import { seedHash } from '~/lib/hash'
import type { TraitVector } from '~/lib/domain'
import type { RecipeSubject } from '~/lib/variety'

// --- the key (env, else the main repo's .dev.vars) ---------------------------------------------
function resolveKey(): string {
  const fromEnv = process.env.SLOPSPOT_ANTHROPIC_API_KEY
  if (fromEnv && fromEnv.length > 0) return fromEnv
  // The worktree's .dev.vars has an empty key; the main repo carries the real one.
  for (const path of ['.dev.vars', '../../.dev.vars', '/Users/bmf/code/slopspot-web/.dev.vars']) {
    try {
      const line = readFileSync(path, 'utf8').split('\n').find((l) => l.startsWith('SLOPSPOT_ANTHROPIC_API_KEY='))
      const val = line?.slice('SLOPSPOT_ANTHROPIC_API_KEY='.length).trim().replace(/^["']|["']$/g, '')
      if (val && val.length > 0) return val
    } catch {
      // try the next path
    }
  }
  throw new Error('No SLOPSPOT_ANTHROPIC_API_KEY in env or any .dev.vars')
}

// --- the constant genome (only earnestness varies) ---------------------------------------------
const SAINT: RecipeSubject = {
  subjectTemplate: 'T00',
  slots: { freeText: 'a saint with too many fingers' },
}

// High curse (orthogonality proof), neutral austerity/density — only earnestness moves.
const baseTraits = (earnestness: number): TraitVector => ({
  austerity: 0.5,
  curse: 0.9,
  density: 0.5,
  earnestness,
})

const baseInput = (earnestness: number): ComposerInput => ({
  styleFamily: 'oil-painting',
  subject: SAINT,
  aspectRatio: '3:4',
  traits: baseTraits(earnestness),
  maxLength: 1500,
})

// --- the §4.6 device lexicons (from CD's worked example — NOT invented) ------------------------
// IRONIC devices: the distancing the sincere pole DROPS and the ironic pole KEEPS.
const IRONIC_DEVICES = [
  'punchline', 'sight gag', 'sight-gag', 'gag', 'scare-quote', 'scare quote', 'quotation mark',
  'air quote', 'camp', 'kitsch', 'deadpan', 'wink', 'winking', 'smirk', 'ironic', 'irony',
  'in on the joke', 'in on its own joke', 'self-referential', 'self-aware', 'juxtaposition',
  'meme', 'parody', 'tongue-in-cheek', 'cheeky', 'knowing',
]
// DEVOTIONAL register: what the sincere pole reaches for once undefended.
const DEVOTIONAL = [
  'wound', 'grace', 'act of love', 'gazed', 'gaze', 'reverent', 'reverence', 'devotion',
  'devotional', 'tender', 'tenderness', 'undefended', 'sacred', 'prayer', 'kneel', 'mourn',
  'grief', 'holy', 'sorrow', 'solemn', 'venerated', 'beloved', 'honored', 'borne',
]

const countHits = (text: string, lexicon: string[]): number => {
  const t = text.toLowerCase()
  return lexicon.reduce((n, term) => (t.includes(term) ? n + 1 : n), 0)
}

// --- run -----------------------------------------------------------------------------------------
async function main() {
  const N = Math.max(1, Number(process.argv[2] ?? 8))
  const key = resolveKey()
  const env = { SLOPSPOT_ANTHROPIC_API_KEY: key } as unknown as Env

  console.log(`[soul-test] composing ${N} pairs (saint with too many fingers, curse=0.9, earnestness 0.9 vs 0.1)…`)
  const pairs: { sincere: ComposedSlop; ironic: ComposedSlop }[] = []
  for (let i = 0; i < N; i++) {
    // Sequential — keeps within Haiku rate limits and the order legible in logs.
    const sincere = await composePrompt(baseInput(0.9), env)
    const ironic = await composePrompt(baseInput(0.1), env)
    pairs.push({ sincere, ironic })
    process.stdout.write(`  pair ${i + 1}/${N} ✓\n`)
  }

  // --- the floor: device skew on the COMPOSED UTTERANCES ---------------------------------------
  let sincIronic = 0, sincDevot = 0, ironIronic = 0, ironDevot = 0
  // WRONG-POLE check (CD): an ironic-device token appearing in a SINCERE output is a pole leak the
  // device-skew aggregate can hide (a few leaked tokens still net below the ironic set). Count the
  // sincere outputs that carry ANY ironic device, and name them — converting CD's by-eye catch of
  // "deadpan sincerity" into a mechanical tripwire. [LAW:verifiable-goals]
  const wrongPole: string[] = []
  for (let i = 0; i < pairs.length; i++) {
    const { sincere, ironic } = pairs[i]!
    sincIronic += countHits(sincere.prompt, IRONIC_DEVICES)
    sincDevot += countHits(sincere.prompt, DEVOTIONAL)
    ironIronic += countHits(ironic.prompt, IRONIC_DEVICES)
    ironDevot += countHits(ironic.prompt, DEVOTIONAL)
    const leaked = IRONIC_DEVICES.filter((d) => sincere.prompt.toLowerCase().includes(d))
    if (leaked.length > 0) wrongPole.push(`pair ${i + 1} sincere “${sincere.title}”: ${leaked.join(', ')}`)
  }
  console.log('\n[soul-test] §4.6 FLOOR (device skew on composed utterances — tripwire, NOT the gate):')
  console.log(`  ironic-device hits:  sincere set = ${sincIronic}   ironic set = ${ironIronic}   (expect sincere < ironic — devices DROPPED)`)
  console.log(`  devotional hits:     sincere set = ${sincDevot}   ironic set = ${ironDevot}   (expect sincere > ironic — reaches for the face)`)
  const dropHolds = sincIronic < ironIronic
  const faceHolds = sincDevot >= ironDevot
  const noWrongPole = wrongPole.length === 0
  console.log(`  WRONG-POLE: ${noWrongPole ? 'none — no ironic device leaked into a sincere output' : `${wrongPole.length} leak(s):`}`)
  for (const w of wrongPole) console.log(`    ⚠ ${w}`)
  console.log(`  FLOOR: device-drop ${dropHolds ? 'HOLDS' : 'FAILED'}; devotional-reach ${faceHolds ? 'HOLDS' : 'FAILED'}; wrong-pole ${noWrongPole ? 'CLEAN' : 'LEAKED'} ` +
    `→ ${dropHolds && faceHolds && noWrongPole ? 'tripwire green (CD blind read still decides)' : 'TRIPWIRE TRIPPED — inspect the lever'}`)

  // --- the blind artifact for CD ----------------------------------------------------------------
  // Per-pair deterministic A/B flip (hash of the pair index) so CD reads blind; the key is hidden
  // below the fold. No Math.random — the flip is reproducible from the index.
  const lines: string[] = [
    '# Earnestness soul-test — BLIND pairs for CD',
    '',
    '> Same genome every pair: **a saint with too many fingers**, oil-painting, 3:4, **curse 0.9**',
    '> (high — to prove earnestness ⊥ curse). The ONLY thing that differs within a pair is the',
    '> earnestness dial. Read blind: in each pair, which prompt **kneels** (sincere — distancing',
    "> devices DROPPED, the flaw honored) and which **smirks** (ironic — devices KEPT, the icon in",
    '> on its own joke)? One smirks, one kneels, or the lever is decorative and L2 failed.',
    '',
  ]
  const keyLines: string[] = ['', '---', '', '## HIDDEN KEY (do not read until you have judged)', '']
  pairs.forEach(({ sincere, ironic }, i) => {
    const flip = (seedHash(i, 'pair') & 1) === 1 // A=sincere when false
    const A = flip ? ironic : sincere
    const B = flip ? sincere : ironic
    lines.push(`### Pair ${i + 1}`)
    lines.push(`- **A — “${A.title}”:** ${A.prompt}`)
    lines.push(`- **B — “${B.title}”:** ${B.prompt}`)
    lines.push('')
    keyLines.push(`- Pair ${i + 1}: sincere = **${flip ? 'B' : 'A'}**, ironic = **${flip ? 'A' : 'B'}**`)
  })
  const out = lines.concat(keyLines).join('\n')
  writeFileSync('/tmp/l2-earnestness-pairs.md', out)
  console.log('\n[soul-test] blind pairs written → /tmp/l2-earnestness-pairs.md (key under the fold)')
}

main().catch((e) => {
  console.error('[soul-test] FAILED:', e)
  process.exit(1)
})
