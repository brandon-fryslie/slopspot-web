// The FORK C re-voice EVAL GATE entrypoint (slopspot-voice-w2v.7). The PROPERTY gate, run against LIVE
// Haiku — the deploy step calls this and BLOCKS on the exit code. Distinct from CI: CI proves the machinery
// deterministically (app/eval/__tests__/revoice-eval.test.ts with a mock judge); THIS runs the real Haiku
// transport + a real blind LLM judge over the recorded sample set and checks the numbers against the bars.
//
// [LAW:verifiable-goals] emits NUMBERS vs BARS and exits non-zero when either axis misses — machine-checked,
// deploy-blocking, never eyeballed. [LAW:no-silent-fallbacks] no key / empty samples / a transport failure
// all fail LOUD, never a vacuous pass. CD reads the printed per-axis numbers the way it reads the 8/8.
//
// NOT a vitest test (it calls a paid, non-deterministic API). Run deliberately / in the .7 deploy step:
//   pnpm exec tsx --tsconfig tsconfig.cloudflare.json scripts/revoice-eval-gate.ts
// Reads SLOPSPOT_ANTHROPIC_API_KEY from env or .dev.vars (shared resolver).

import { resolveAnthropicKey } from './anthropic-key'
import { runReVoiceEvalGate, SAMPLES, type AxisResult } from '~/eval/revoice-eval'

function line(label: string, a: AxisResult): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`
  // Gate decides on the lower bound; show both the point estimate and the bound vs the bar.
  return `  ${label.padEnd(9)} obs ${pct(a.rate)}  |  95% lower ${pct(a.lowerBound)} vs ${pct(a.threshold)} bar  (n=${a.n})  ${a.pass ? 'PASS' : 'FAIL'}`
}

async function main() {
  // [LAW:capabilities-over-context] the gate grants callHaiku exactly the key it needs, nothing more.
  const env = { SLOPSPOT_ANTHROPIC_API_KEY: resolveAnthropicKey() } as unknown as Env

  // Sweep knobs (env, optional): REVOICE_TEMP overrides the re-voice temperature to find the warmest passing
  // point; REGISTER_LIMIT subsets the pairs for a cheaper sweep run. The unconfigured gate uses the shipped
  // temp + the full sample set.
  const revoiceTemp = process.env.REVOICE_TEMP !== undefined ? Number(process.env.REVOICE_TEMP) : undefined
  const limit = process.env.REGISTER_LIMIT !== undefined ? Number(process.env.REGISTER_LIMIT) : undefined
  const samples = limit !== undefined ? { register: SAMPLES.register.slice(0, limit) } : undefined

  console.log(
    `FORK C re-voice eval — live Haiku, blind judge` +
      `${revoiceTemp !== undefined ? ` | re-voice temp=${revoiceTemp}` : ''}` +
      `${limit !== undefined ? ` | register pairs=${limit}` : ''}\n`,
  )
  const report = await runReVoiceEvalGate(env, { revoiceTemp, samples })

  // Calibration first — the judge must match the eye on the obvious before its register% is trusted.
  console.log(`  judge calibration: ${report.calibration.calibrated ? 'CALIBRATED' : 'UNCALIBRATED — register% NOT trustworthy'}`)
  for (const o of report.calibration.outcomes) {
    console.log(`    ${o.correct ? '✓' : '✗'} expect ${o.expected}, judged ${o.judged}  | ${o.note}`)
  }
  console.log('')
  console.log(line('grounding', report.grounding))
  console.log(line('register', report.register))

  // Per-arm detail — read like the 8/8: which line the blind judge called, and where it slipped.
  console.log('\n  register arms (blind judge): expected → judged')
  for (const d of report.registerDetail) {
    console.log(`    ${d.correct ? '✓' : '✗'} ${d.expected} → ${d.judged}  | ${d.line}`)
  }
  const ungrounded = report.groundingDetail.filter((d) => !d.grounded)
  if (ungrounded.length > 0) {
    console.log('\n  ungrounded lines (blind-writable — failed grounding):')
    for (const d of ungrounded) console.log(`    ✗ ${d.line}  | from: ${d.reasoning}`)
  }

  console.log(`\n  GATE: ${report.pass ? 'PASS' : 'FAIL'}\n`)

  // Exit code IS the gate signal — the deploy step blocks on it.
  process.exit(report.pass ? 0 : 1)
}

main().catch((err) => {
  console.error('revoice-eval-gate: FAILED to run (no vacuous pass)', err)
  process.exit(1)
})
