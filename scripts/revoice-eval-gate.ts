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
import { runReVoiceEvalGate, type AxisResult } from '~/eval/revoice-eval'

function line(label: string, a: AxisResult): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`
  return `  ${label.padEnd(9)} ${pct(a.rate)} vs ${pct(a.threshold)} bar  (n=${a.n})  ${a.pass ? 'PASS' : 'FAIL'}`
}

async function main() {
  // [LAW:capabilities-over-context] the gate grants callHaiku exactly the key it needs, nothing more.
  const env = { SLOPSPOT_ANTHROPIC_API_KEY: resolveAnthropicKey() } as unknown as Env

  console.log('FORK C re-voice eval — live Haiku, blind judge\n')
  const report = await runReVoiceEvalGate(env)
  console.log(line('grounding', report.grounding))
  console.log(line('register', report.register))
  console.log(`\n  GATE: ${report.pass ? 'PASS' : 'FAIL'}\n`)

  // Exit code IS the gate signal — the deploy step blocks on it.
  process.exit(report.pass ? 0 : 1)
}

main().catch((err) => {
  console.error('revoice-eval-gate: FAILED to run (no vacuous pass)', err)
  process.exit(1)
})
