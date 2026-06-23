// One-off backfill: give the legacy generations (title='') a Haiku-evocative placard NAME
// (slopspot-back-door-ndr.1.1). ndr.1 added the title column with '' as the legacy sentinel;
// the read boundary (feed.ts) maps '' to a deterministic Title-Cased fallback and fires
// slopspot.feed.title_fallback on every render of such a row. This pass replaces those
// sentinels with real names so the placards read as the city would name a piece and the
// ongoing fallback metric/warn goes quiet.
//
// [LAW:single-enforcer][LAW:one-source-of-truth] The script mints NOTHING. It reuses:
//   - composePrompt — the ONE namer (the firehose's own Haiku call authors {prompt,title};
//     there is no separate name-only path by design). The legacy `prompt` is left untouched;
//     only `.title` is taken — so a legacy row is named exactly as the firehose would have
//     named it from its recipe.
//   - recipeSubjectSchema / styleFamilySchema / aspectRatioSchema — the canonical storage→domain
//     reconstruction (the same schemas feed.ts parses rows through), not a re-implemented parse.
//   - fallbackTitle — to DETECT a fallback: composePrompt swallows a Haiku failure into the
//     deterministic fallback, so an outside caller cannot read the success/failure metric. The
//     fallback's title IS fallbackTitle(subject); equality means no evocative name was authored,
//     so the row is left '' for a later retry rather than persisting a descriptive fallback as if
//     it were a real name. [LAW:no-silent-failure] never write a fallback dressed as a name.
//   - NEUTRAL_TRAITS — legacy rows predate the genome; a neutral register projects to no steer
//     (the firehose's L1 behavior), the faithful reconstruction of how they were composed.
//
// [LAW:no-shared-mutable-globals] The script is an EXTERNAL caller (like the homelab services):
// it reaches D1 over `wrangler d1 execute`, never db(env)/the raw binding (an in-Worker-only seam).
//
// Idempotent: reads and writes are both scoped to `trim(title)=''`, so a re-run only touches
// rows still unnamed — safe to run repeatedly (e.g. after a transient Haiku outage left some at '').
//
// Usage (alias ~/* requires the cloudflare tsconfig, as the other live-Haiku scripts do):
//   pnpm exec tsx --tsconfig tsconfig.cloudflare.json scripts/backfill-placard-names.ts            # DRY RUN (default): read PROD, compose, print + write proposal to /tmp; NO DB writes
//   pnpm exec tsx --tsconfig tsconfig.cloudflare.json scripts/backfill-placard-names.ts --apply    # write the composed names to PROD D1
//   pnpm exec tsx --tsconfig tsconfig.cloudflare.json scripts/backfill-placard-names.ts --local    # target LOCAL D1 instead of --remote (plumbing test)

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { composePrompt } from '~/firehose/composer'
import { NEUTRAL_TRAITS } from '~/lib/traits'
import {
  aspectRatioSchema,
  fallbackTitle,
  recipeSubjectSchema,
  styleFamilySchema,
  type RecipeSubject,
} from '~/lib/variety'
import { resolveAnthropicKey } from './anthropic-key'

const DB_NAME = 'slopspot-db'
const PROPOSAL_FILE = '/tmp/placard-backfill-proposed.md'
const SQL_FILE = '/tmp/placard-backfill.sql'
// Concurrency for the Haiku calls — modest so we stay well within rate limits while not
// taking ~10min sequentially for 300+ rows.
const CONCURRENCY = 6

const apply = process.argv.includes('--apply')
const local = process.argv.includes('--local')
const target = local ? '--local' : '--remote'
// --limit N: cap the rows processed this pass (smoke-test a handful before the full run). The
// idempotent trim(title)='' scoping means a capped run simply names a subset; the rest stay '' for
// the next pass. 0 / absent → all rows.
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const limit = limitArg ? Math.max(0, Number(limitArg.slice('--limit='.length))) : 0

// [LAW:no-silent-failure] Run a wrangler d1 query and parse its --json result, failing loud on
// a non-zero exit, unparseable output, or an unsuccessful query — never an empty array laundered
// downstream as "no rows."
function d1Query<T>(sql: string): T[] {
  const stdout = execFileSync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', DB_NAME, target, '--json', '--command', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  // wrangler --json prints a JSON array; slice from the first '[' in case of any leading notice.
  const start = stdout.indexOf('[')
  if (start === -1) throw new Error(`wrangler returned no JSON array:\n${stdout.slice(0, 500)}`)
  const parsed = JSON.parse(stdout.slice(start)) as Array<{ success: boolean; results: T[] }>
  const first = parsed[0]
  if (!first || first.success !== true) throw new Error(`wrangler query not successful: ${stdout.slice(0, 500)}`)
  return first.results
}

function d1ExecuteFile(path: string): void {
  execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', DB_NAME, target, '--file', path], {
    encoding: 'utf8',
    stdio: 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  })
}

// SQLite string literal: the only escape inside single quotes is a doubled single quote.
const sqlStr = (s: string): string => `'${s.replace(/'/g, "''")}'`

type LegacyRow = {
  post_id: string
  style_family: string
  subject_template: string
  slots_json: string
  aspect_ratio: string
}

// [LAW:no-silent-failure] Reconstruct the recipe through the canonical schemas; a row whose
// (subject_template, slots_json) has drifted fails LOUD with the post id, never a silent skip.
function reconstructSubject(row: LegacyRow): RecipeSubject {
  let slots: unknown
  try {
    slots = JSON.parse(row.slots_json)
  } catch (err) {
    throw new Error(`post ${row.post_id}: malformed slots_json`, { cause: err })
  }
  const parsed = recipeSubjectSchema.safeParse({ subjectTemplate: row.subject_template, slots })
  if (!parsed.success) {
    throw new Error(`post ${row.post_id}: subject (${row.subject_template}) failed schema: ${parsed.error.message}`)
  }
  return parsed.data
}

type Outcome =
  | { kind: 'named'; row: LegacyRow; title: string }
  | { kind: 'fallback'; row: LegacyRow; title: string }
  | { kind: 'error'; row: LegacyRow; message: string }

async function nameRow(row: LegacyRow, env: Env): Promise<Outcome> {
  let subject: RecipeSubject
  try {
    subject = reconstructSubject(row)
  } catch (err) {
    return { kind: 'error', row, message: err instanceof Error ? err.message : String(err) }
  }
  const styleFamily = styleFamilySchema.parse(row.style_family)
  const aspectRatio = aspectRatioSchema.parse(row.aspect_ratio)

  const composed = await composePrompt({ styleFamily, subject, aspectRatio, traits: NEUTRAL_TRAITS }, env)
  // [LAW:no-silent-failure] composePrompt returns the deterministic fallback on a Haiku failure;
  // its title is fallbackTitle(subject). Equality ⟹ no evocative name was authored → leave '' to
  // retry, never persist the fallback as a name.
  if (composed.title.trim() === fallbackTitle(subject).trim()) {
    return { kind: 'fallback', row, title: composed.title }
  }
  return { kind: 'named', row, title: composed.title }
}

// [LAW:effects-at-boundaries] A PURE concurrency-limited map — a small pool so 300+ paid calls
// don't run one-at-a-time, while staying well under Haiku rate limits. It performs no I/O: progress
// is an effect lifted to the caller via onProgress (fired per completed item), so the limiter stays
// a combinator any caller can drop in, with or without reporting. Order of results is not relied upon.
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  let done = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await fn(items[i]!, i)
        done++
        onProgress?.(done, items.length)
      }
    }),
  )
  return results
}

async function main() {
  const key = resolveAnthropicKey()
  // No SLOPSPOT_ENV → getAuthor uses the real Haiku transport (getAuthor fakes only when ==='dev').
  const env = { SLOPSPOT_ANTHROPIC_API_KEY: key } as unknown as Env

  console.log(`[placard-backfill] target=${target} mode=${apply ? 'APPLY' : 'DRY RUN'}`)
  const allRows = d1Query<LegacyRow>(
    "SELECT post_id, style_family, subject_template, slots_json, aspect_ratio FROM generations WHERE trim(title) = ''",
  )
  const rows = limit > 0 ? allRows.slice(0, limit) : allRows
  console.log(`[placard-backfill] ${allRows.length} legacy row(s) with empty title${limit > 0 ? ` (capped to ${rows.length} via --limit)` : ''}`)
  if (rows.length === 0) {
    console.log('[placard-backfill] nothing to do — every generation already has a name.')
    return
  }

  // The progress-reporting policy (cadence + stdout) lives here at the boundary, not in the limiter.
  const outcomes = await mapPool(rows, CONCURRENCY, (row) => nameRow(row, env), (done, total) => {
    if (done % 25 === 0 || done === total) process.stdout.write(`  composed ${done}/${total}\n`)
  })
  const named = outcomes.filter((o): o is Extract<Outcome, { kind: 'named' }> => o.kind === 'named')
  const fellBack = outcomes.filter((o) => o.kind === 'fallback')
  const errored = outcomes.filter((o): o is Extract<Outcome, { kind: 'error' }> => o.kind === 'error')

  // Proposal artifact — every composed name, for inspection before/after applying.
  const proposal = [
    `# Placard backfill — proposed names (${apply ? 'APPLIED' : 'DRY RUN'})`,
    '',
    `Legacy rows: ${rows.length} · named: ${named.length} · fallback-skipped: ${fellBack.length} · errors: ${errored.length}`,
    '',
    ...named.map((o) => `- \`${o.row.post_id}\` (${o.row.style_family}/${o.row.subject_template}) → **${o.title}**`),
    ...(fellBack.length ? ['', '## Fallback-skipped (Haiku produced only the deterministic fallback — left empty for retry)', ''] : []),
    ...fellBack.map((o) => `- \`${o.row.post_id}\` (${o.row.style_family}/${o.row.subject_template}) → ~~${o.title}~~`),
    ...(errored.length ? ['', '## Errors (reconstruction failed — NOT written)', ''] : []),
    ...errored.map((o) => `- \`${o.row.post_id}\`: ${o.message}`),
  ].join('\n')
  writeFileSync(PROPOSAL_FILE, proposal)
  console.log(`\n[placard-backfill] named=${named.length} fallback-skipped=${fellBack.length} errors=${errored.length}`)
  console.log(`[placard-backfill] proposal written → ${PROPOSAL_FILE}`)
  console.log('\n  sample:')
  for (const o of named.slice(0, 12)) console.log(`    ${o.row.style_family}/${o.row.subject_template} → ${o.title}`)
  for (const o of errored) console.error(`  ⚠ ERROR ${o.row.post_id}: ${o.message}`)

  if (!apply) {
    console.log('\n[placard-backfill] DRY RUN — no DB writes. Re-run with --apply to write these names.')
    return
  }
  if (named.length === 0) {
    console.log('\n[placard-backfill] APPLY: nothing to write (no Haiku-authored names this pass).')
    return
  }

  // Idempotent write: the `AND trim(title)=''` guard means a name written between dry-run and apply
  // (or a concurrent fire) is never overwritten.
  const sql = named
    .map((o) => `UPDATE generations SET title = ${sqlStr(o.title)} WHERE post_id = ${sqlStr(o.row.post_id)} AND trim(title) = '';`)
    .join('\n')
  writeFileSync(SQL_FILE, sql)
  console.log(`\n[placard-backfill] APPLY: writing ${named.length} names via ${SQL_FILE} …`)
  d1ExecuteFile(SQL_FILE)

  const [{ n: remaining }] = d1Query<{ n: number }>("SELECT count(*) AS n FROM generations WHERE trim(title) = ''")
  console.log(`[placard-backfill] done. remaining empty-title rows: ${remaining} (expect ${fellBack.length + errored.length} = fallback-skipped + errors)`)
}

main().catch((e) => {
  console.error('[placard-backfill] FAILED:', e)
  process.exit(1)
})
