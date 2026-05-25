// [LAW:one-source-of-truth] Reuses the CMU syllables asset as an English
// word membership oracle. Keys are normalized to match the tokenizer used
// in secret-gates.ts: strip leading/trailing apostrophes, keep alpha+apostrophe.
import cmuSyllables from './cmu-syllables.json'

const raw = cmuSyllables as Record<string, string>

export const WORD_SET: Set<string> = new Set(
  Object.keys(raw)
    .map((k) => k.replace(/^'+|'+$/g, ''))
    .filter((k) => k.length > 0 && /^[a-z][a-z']*$/.test(k)),
)
