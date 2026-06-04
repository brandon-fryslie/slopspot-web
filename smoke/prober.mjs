// [LAW:single-enforcer] The prober translates the canonical smoke suite's result
// into the ONE metric signal the EXISTING alerting pipeline consumes
// (VictoriaMetrics -> vmalert -> Alertmanager -> ntfy bridge). It has NO alerting
// logic of its own — no thresholds, no ntfy, no debounce. The alert DECISION lives
// as vmalert config data (== 0 for 10m + an absent() staleness rule), never here.
// [LAW:dataflow-not-control-flow] this is a pure translation: run the suite, read
// its result, push per-check + overall gauges, done.
//
// [LAW:no-silent-fallbacks] CRITICAL down-target invariant: when prod is down the
// suite's beforeAll throws, so vitest SKIPS every test — numFailedTests:0 but
// success:false. A check is therefore green ONLY when its status === 'passed'
// (skipped/failed/pending -> 0), and `overall` keys on the suite-level `success`.
// Keying on status === 'failed' would emit all-green on a down target — a
// false-green on the exact outage class this prober exists to catch.

import { spawnSync } from 'node:child_process'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const METRIC = 'slopspot_smoke_pass'
const VM_URL = process.env.VICTORIA_METRICS_URL
const DRY_RUN = process.env.SMOKE_PROBER_DRY_RUN === '1'

// [LAW:no-silent-fallbacks] No push target and not an explicit dry run = the prober
// cannot do its one job. Fail loud rather than run the suite and discard the signal.
if (!VM_URL && !DRY_RUN) {
  console.error('[prober] VICTORIA_METRICS_URL unset and SMOKE_PROBER_DRY_RUN!=1 — nowhere to push the smoke signal')
  process.exit(2)
}

// Run the CANONICAL suite (one-source-of-truth — the prober runs the real
// `pnpm smoke`, never a reimplementation) with the JSON reporter to a temp file.
const outFile = join(mkdtempSync(join(tmpdir(), 'smoke-prober-')), 'result.json')
const run = spawnSync('pnpm', ['smoke', '--reporter=json', '--outputFile', outFile], {
  encoding: 'utf8',
  stdio: ['ignore', 'inherit', 'inherit'],
})

const checks = readChecks(outFile, run)
const text = gauge(checks)
console.log(text)
const pushed = await pushMetrics(text)
// [LAW:dataflow-not-control-flow] Exit 0 once the TRUE result is delivered — the
// metric carries pass/fail, so a check failure must NOT also fail the alloc and
// trigger a Nomad retry that re-runs + overwrites this period's honest signal.
// A delivery failure (can't reach VM) exits nonzero: Nomad retries, and the metric
// goes stale so the absent() staleness rule fires. The two failure classes stay distinct.
process.exit(pushed ? 0 : 4)

function readChecks(file, runResult) {
  let report
  try {
    report = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    // vitest produced no readable report (crash / pnpm missing / OOM): emit an
    // immediate harness=0 so the failure is visible now, not only via staleness.
    console.error('[prober] no readable vitest JSON report — harness failure', {
      status: runResult.status,
      spawnError: runResult.error?.message,
    }, err)
    return [{ check: 'harness', value: 0 }, { check: 'overall', value: 0 }]
  }
  const perCheck = (report.testResults ?? [])
    .flatMap((s) => s.assertionResults ?? [])
    .map((a) => ({ check: checkLabel(a.title), value: a.status === 'passed' ? 1 : 0 }))
  // `overall` keys on suite-level success — robust to the beforeAll/suite-level
  // failures (down target) that the per-test status alone misses.
  perCheck.push({ check: 'overall', value: report.success ? 1 : 0 })
  return perCheck
}

// The check label is the stable token before the first ':' in each test title
// (the liveness titles use a uniform `<check>: ...` convention). Slugified so it
// is a clean Prometheus label value.
function checkLabel(title) {
  const head = String(title).split(':', 1)[0].trim()
  const slug = (head || String(title)).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return slug || 'unknown'
}

function gauge(rows) {
  const lines = [
    `# HELP ${METRIC} 1 if the prod smoke check passed, 0 otherwise (check="overall" is the suite-level verdict)`,
    `# TYPE ${METRIC} gauge`,
  ]
  for (const r of rows) lines.push(`${METRIC}{check="${r.check}"} ${r.value}`)
  return lines.join('\n') + '\n'
}

async function pushMetrics(text) {
  if (DRY_RUN) {
    console.log('[prober] DRY_RUN — not pushing')
    return true
  }
  const url = `${VM_URL.replace(/\/$/, '')}/api/v1/import/prometheus`
  try {
    const res = await fetch(url, { method: 'POST', body: text })
    if (!res.ok) {
      console.error(`[prober] VM push ${url} -> HTTP ${res.status}`)
      return false
    }
    const series = text.split('\n').filter((l) => l.startsWith(METRIC)).length
    console.log(`[prober] pushed ${series} series to ${url}`)
    return true
  } catch (err) {
    console.error(`[prober] VM push to ${url} threw`, err)
    return false
  }
}
