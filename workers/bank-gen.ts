// [LAW:locality-or-seam] bank-gen is its own seam: it writes to CHALLENGE_BANK
// KV; the hot path reads from it. workers/app.ts dispatches by event.cron — no
// other module knows this file exists.
//
// [LAW:one-way-deps] bank-gen → KV (write). GET /api/challenge → KV (read).
// No back-edge.

import {
  type EasyForm,
  type HardForm,
  describeEasy,
  describeHard,
} from '~/lib/forms'

// ─── BankEntry ───────────────────────────────────────────────────────────────

// [LAW:types-are-the-program] BankEntry is the canonical shape written to KV
// and read by GET /api/challenge. The easy_form and hard_form fields carry the
// full discriminated-union values — no string encoding — so the reader can
// verify() without re-parsing.
export type BankEntry = {
  id: string
  briefing_text: string
  easy_form: EasyForm
  hard_form: HardForm
  generated_at: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BATCH_SIZE = 1000

// Concurrency for Anthropic API calls. At 10 concurrent calls × ~1s/call,
// the batch finishes in ~100s — well within the 15-minute scheduled-event limit.
// Tune upward if the account has a higher Anthropic rate-limit tier.
const CONCURRENCY = 10

const BANK_TTL_SECONDS = 48 * 60 * 60

// Per-request timeout for Claude API calls. A hung connection at 30s is skipped
// so it doesn't stall the batch indefinitely.
const REQUEST_TIMEOUT_MS = 30_000

// claude-haiku-4-5-20251001: cost-efficient for bulk generation (~1000 calls/day).
// Briefings are short (150-300 words) so quality difference vs Sonnet is negligible.
// To switch models, change this constant and redeploy.
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'

// ─── Random form generators ───────────────────────────────────────────────────

function rInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function rItem<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Common English letters weighted toward ones that create interesting lipograms.
const LIPOGRAM_LETTERS = ['e', 't', 'a', 'o', 'i', 'n', 's', 'r', 'h'] as const

// Short amusing words that work as acrostic targets.
const ACROSTIC_TARGETS = [
  'SLOP', 'MUCK', 'FLUX', 'GUNK', 'VOID', 'GRIM', 'BLOB', 'HAZE',
  'MIRE', 'CRUD', 'DANK', 'SLOG', 'MURK', 'OOZE', 'FUNK',
] as const

// Suffix pool for every_word_ends_with — common English morphemes.
const WORD_SUFFIXES = ['ing', 'ly', 'ed', 'er', 'ness', 'al', 'ful'] as const

// Initial letters that produce alliterative fun.
const ALLITERATIVE_LETTERS = ['s', 'p', 'm', 'b', 'f', 'g', 'h', 'w', 'c', 'r'] as const

// Simple regexes the LLM can reliably satisfy for word_at_index_matches.
const SIMPLE_REGEXES = [
  { regex: '[aeiou]$', hint: 'ends with a vowel' },
  { regex: '^[^aeiou]', hint: 'starts with a consonant' },
  { regex: 'ing$', hint: 'ends with "ing"' },
  { regex: 'ed$', hint: 'ends with "ed"' },
  { regex: 'ly$', hint: 'ends with "ly"' },
] as const

// [LAW:dataflow-not-control-flow] Each generator picks params from fixed pools —
// variability is in the values, not in which branch executes.
const EASY_GENERATORS: Array<() => EasyForm> = [
  () => ({ kind: 'nth_word_from_end_has_length', n: rInt(1, 5), length: rInt(3, 8) }),
  () => {
    const divisor = rItem([3, 4, 5, 7] as const)
    return { kind: 'word_count_modulo', divisor, residue: rInt(1, divisor - 1) }
  },
  () => ({
    kind: 'specific_position_letter',
    position: rInt(1, 10),
    letter: rItem('etaoinshrdlc'.split('') as string[]),
  }),
  () => ({ kind: 'word_length_at_index', index: rInt(0, 4), length: rInt(3, 8) }),
  () => ({
    kind: 'punctuation_count_exact',
    mark: rItem(['.', ',', '!', '?'] as const),
    count: rInt(1, 3),
  }),
  () => {
    const len = rInt(3, 5)
    const chars = Array.from({ length: len }, () => rItem(['C', 'V'] as const))
    return { kind: 'first_letter_pattern', pattern: chars.join('') }
  },
  () => {
    const { regex } = rItem(SIMPLE_REGEXES)
    return { kind: 'word_at_index_matches', index: rInt(0, 4), regex }
  },
  () => ({
    kind: 'no_word_at_index_starts_with',
    index: rInt(0, 4),
    letter: rItem('etaoinshrdlc'.split('') as string[]),
  }),
]

const HARD_GENERATORS: Array<() => HardForm> = [
  () => ({ kind: 'lipogram', forbidden: rItem(LIPOGRAM_LETTERS) }),
  () => ({ kind: 'acrostic', target: rItem(ACROSTIC_TARGETS) }),
  () => ({ kind: 'every_word_unique_first_letter' }),
  () => ({ kind: 'embedded_palindrome', minLength: rInt(3, 5) }),
  () => ({ kind: 'pangram' }),
  () => ({ kind: 'every_word_ends_with', suffix: rItem(WORD_SUFFIXES) }),
  () => ({ kind: 'word_lengths_strictly_increasing' }),
  () => ({ kind: 'no_word_repeats' }),
  () => ({ kind: 'every_word_starts_same_letter', letter: rItem(ALLITERATIVE_LETTERS) }),
  () => ({ kind: 'haiku' }),
  () => ({ kind: 'monosyllabic' }),
  () => ({ kind: 'iambic_pentameter', lines: rInt(1, 3) }),
]

export function randomEasyForm(): EasyForm {
  return rItem(EASY_GENERATORS)()
}

export function randomHardForm(): HardForm {
  return rItem(HARD_GENERATORS)()
}

// ─── Meta-prompt builder ──────────────────────────────────────────────────────

// [LAW:verifiable-goals] The meta-prompt is a pure function of the form values.
// Tests verify it contains both describe() outputs without mocking anything.
export function buildMetaPrompt(easy: EasyForm, hard: HardForm): string {
  return `You are writing a SlopSpot generation-API briefing for an AI agent. The briefing must:

- Be 150-300 words, written in the SlopSpot voice: mock-bureaucratic, absurd, and sincere
- Clearly declare TWO structural constraints the agent must satisfy in their image prompt:
  EASY CONSTRAINT: ${describeEasy(easy)}
  HARD CONSTRAINT: ${describeHard(hard)}
- Inform the agent they may choose any creative subject for their image prompt — the constraints apply to the TEXT of the prompt they submit
- End with explicit submission instructions: the token expires in 240 seconds; the prompt IS the response — there is no acknowledgement field; submit only the constrained image prompt text

Output only the briefing text itself. No preamble, no meta-commentary, no quotation marks around the briefing.`
}

// ─── Anthropic API caller ─────────────────────────────────────────────────────

type AnthropicMessage = {
  content: Array<{ type: string; text?: string }>
}

// Direct fetch — follows the replicate-helpers pattern (no SDK dep) and runs
// cleanly in Workers without any Node shims.
export async function callClaudeApi(prompt: string, apiKey: string): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let resp: Response
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }

  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`Anthropic API ${resp.status}: ${body}`)
  }

  const data = (await resp.json()) as AnthropicMessage
  const textBlock = data.content.find((b) => b.type === 'text')
  if (!textBlock?.text) throw new Error('No text block in Anthropic response')

  return textBlock.text.trim()
}

// ─── Entry processor ──────────────────────────────────────────────────────────

type EntryResult = { ok: true } | { ok: false; easyKind: string; hardKind: string }

async function processEntry(apiKey: string, kv: KVNamespace): Promise<EntryResult> {
  const easy = randomEasyForm()
  const hard = randomHardForm()
  const prompt = buildMetaPrompt(easy, hard)

  let briefingText: string
  try {
    briefingText = await callClaudeApi(prompt, apiKey)
  } catch {
    // One retry per entry — transient errors (rate limit, timeout) often clear.
    try {
      briefingText = await callClaudeApi(prompt, apiKey)
    } catch (retryErr) {
      console.error('bank-gen: Claude call failed after retry', {
        easyKind: easy.kind,
        hardKind: hard.kind,
        err: retryErr,
      })
      return { ok: false, easyKind: easy.kind, hardKind: hard.kind }
    }
  }

  const entry: BankEntry = {
    id: crypto.randomUUID(),
    briefing_text: briefingText,
    easy_form: easy,
    hard_form: hard,
    generated_at: Date.now(),
  }

  await kv.put(entry.id, JSON.stringify(entry), { expirationTtl: BANK_TTL_SECONDS })
  return { ok: true }
}

// ─── Main entrypoint ──────────────────────────────────────────────────────────

// [LAW:single-enforcer] runBankGen is the one place that writes to CHALLENGE_BANK.
// workers/app.ts calls it; nothing else does.
//
// [LAW:dataflow-not-control-flow] Processes BATCH_SIZE entries across CONCURRENCY
// concurrent slots. Each batch slot always runs; empty results at the end of the
// last batch are the data deciding that the loop is done, not a branch.
export async function runBankGen(env: Env): Promise<void> {
  const apiKey = env.SLOPSPOT_ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('SLOPSPOT_ANTHROPIC_API_KEY is not configured')

  let successes = 0
  let failures = 0
  const startMs = Date.now()

  const indices = Array.from({ length: BATCH_SIZE }, (_, i) => i)
  for (let offset = 0; offset < BATCH_SIZE; offset += CONCURRENCY) {
    const batch = indices.slice(offset, offset + CONCURRENCY)
    const results = await Promise.all(batch.map(() => processEntry(apiKey, env.CHALLENGE_BANK)))
    for (const r of results) {
      if (r.ok) successes++
      else failures++
    }
  }

  console.log('bank-gen: batch complete', {
    successes,
    failures,
    total: BATCH_SIZE,
    durationMs: Date.now() - startMs,
  })
}
