// [LAW:single-enforcer] One module, one runner. All gates always run on every
// submission; first failure returned. Never run in isolation by callers.
// [LAW:dataflow-not-control-flow] Fixed pipeline; what varies is the data
// (prompt text, word membership), not which checks execute.
import { WORD_SET } from './forms/wordlist'

type SecretGate = {
  id: string
  check(prompt: string): { ok: true } | { ok: false }
}

function tokenize(text: string): string[] {
  return (text.match(/[a-zA-Z']+/g) ?? [])
    .map((w) => w.replace(/^'+|'+$/g, '').toLowerCase())
    .filter((w) => w.length > 0)
}

const wordCountBounds: SecretGate = {
  id: 'word_count_bounds',
  check(prompt) {
    const n = tokenize(prompt).length
    return n >= 5 && n <= 500 ? { ok: true } : { ok: false }
  },
}

const alphaCharRatio: SecretGate = {
  id: 'alpha_char_ratio',
  check(prompt) {
    if (prompt.length === 0) return { ok: false }
    const alpha = (prompt.match(/[a-zA-Z]/g) ?? []).length
    return alpha / prompt.length >= 0.7 ? { ok: true } : { ok: false }
  },
}

const maxWordLength: SecretGate = {
  id: 'max_word_length',
  check(prompt) {
    return tokenize(prompt).every((w) => w.length <= 30) ? { ok: true } : { ok: false }
  },
}

const dictionaryWordRatio: SecretGate = {
  id: 'dictionary_word_ratio',
  check(prompt) {
    const ws = tokenize(prompt)
    if (ws.length === 0) return { ok: false }
    const known = ws.filter((w) => WORD_SET.has(w)).length
    return known / ws.length >= 0.9 ? { ok: true } : { ok: false }
  },
}

// Cheapest gates first — word-count and alpha-ratio are O(n) character scans;
// dictionary lookup has the same O(n) but builds token list first.
export const SECRET_GATES: SecretGate[] = [
  wordCountBounds,
  alphaCharRatio,
  maxWordLength,
  dictionaryWordRatio,
]

export function runSecretGates(prompt: string): { ok: true } | { ok: false; gate: string } {
  for (const gate of SECRET_GATES) {
    const result = gate.check(prompt)
    if (!result.ok) return { ok: false, gate: gate.id }
  }
  return { ok: true }
}
