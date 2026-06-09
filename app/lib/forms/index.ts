// [LAW:types-are-the-program] EasyForm and HardForm are the program.
// The EASY_FORMS/HARD_FORMS mapped types enforce exhaustiveness at declaration
// time; the switch+assertNever in each dispatcher enforces it at call time.
// Adding a variant without a handler entry is a TypeScript build error.
//
// [LAW:one-type-per-behavior] EasyForm and HardForm are distinct unions
// (not one union with a difficulty knob) because they defend against disjoint
// attack classes: positional/mechanical vs. creative/LLM-required.

import cmuSyllables from './cmu-syllables.json'
import { assertNever } from '~/lib/assert-never'

// ─── Shared result type ───────────────────────────────────────────────────────

export type VerifyResult = { ok: true } | { ok: false; detail: string }

// ─── Discriminated union types ────────────────────────────────────────────────

export type EasyForm =
  | { kind: 'nth_word_from_end_has_length'; n: number; length: number }
  | { kind: 'word_count_modulo'; divisor: number; residue: number }
  | { kind: 'specific_position_letter'; position: number; letter: string }
  | { kind: 'word_length_at_index'; index: number; length: number }
  | { kind: 'punctuation_count_exact'; mark: string; count: number }
  | { kind: 'first_letter_pattern'; pattern: string }
  | { kind: 'word_at_index_matches'; index: number; regex: string }
  | { kind: 'no_word_at_index_starts_with'; index: number; letter: string }

export type HardForm =
  | { kind: 'lipogram'; forbidden: string }
  | { kind: 'acrostic'; target: string }
  | { kind: 'every_word_unique_first_letter' }
  | { kind: 'embedded_palindrome'; minLength: number }
  | { kind: 'pangram' }
  | { kind: 'every_word_ends_with'; suffix: string }
  | { kind: 'word_lengths_strictly_increasing' }
  | { kind: 'no_word_repeats' }
  | { kind: 'every_word_starts_same_letter'; letter: string }
  | { kind: 'haiku' }
  | { kind: 'monosyllabic' }
  | { kind: 'iambic_pentameter'; lines: number }

export type FormConstraint = EasyForm | HardForm

// ─── Handler type ─────────────────────────────────────────────────────────────

type FormHandler<F> = {
  describe(form: F): string
  verify(prompt: string, form: F): VerifyResult
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

// Tokenize into words: sequences of letters and in-word apostrophes (contractions).
function words(text: string): string[] {
  return (text.match(/[a-zA-Z']+/g) ?? [])
    .map((w) => w.replace(/^'+|'+$/g, '').toLowerCase())
    .filter((w) => w.length > 0)
}

// Module-level cast: cmuSyllables is a flat word→stress-sequence lookup.
const CMU_DICT = cmuSyllables as Record<string, string>

// Look up syllable stress sequence from CMU dict. Returns null for OOV.
// The stress sequence is a string of '0' (unstressed) and '1' (stressed) chars
// where length = syllable count.
function syllables(word: string): string | null {
  return CMU_DICT[word.toLowerCase()] ?? null
}

// Count syllables in text. Returns { oov } on first unrecognized word.
function countSyllables(text: string): { total: number } | { oov: string } {
  const ws = words(text)
  let total = 0
  for (const w of ws) {
    const seq = syllables(w)
    if (seq === null) return { oov: w }
    total += seq.length
  }
  return { total }
}

// ─── Easy form handlers ───────────────────────────────────────────────────────

// [LAW:types-are-the-program] The mapped type { [K in EasyForm['kind']]: ... }
// requires every EasyForm variant to have a handler. Missing entry → build error.
const EASY_FORMS: { [K in EasyForm['kind']]: FormHandler<Extract<EasyForm, { kind: K }>> } = {
  nth_word_from_end_has_length: {
    describe: (f) =>
      `The ${f.n === 1 ? 'last' : `${ordinal(f.n)}-to-last`} word must be exactly ${f.length} characters long`,
    verify: (prompt, f) => {
      const ws = words(prompt)
      const target = ws[ws.length - f.n]
      if (target === undefined)
        return { ok: false, detail: `fewer than ${f.n} words in submission` }
      if (target.length !== f.length)
        return {
          ok: false,
          detail: `word "${target}" at position ${f.n} from end has ${target.length} chars, need ${f.length}`,
        }
      return { ok: true }
    },
  },

  word_count_modulo: {
    describe: (f) =>
      `The number of words must be congruent to ${f.residue} modulo ${f.divisor} (e.g. ${f.residue}, ${f.residue + f.divisor}, ${f.residue + f.divisor * 2}…)`,
    verify: (prompt, f) => {
      const count = words(prompt).length
      if (count % f.divisor !== f.residue)
        return {
          ok: false,
          detail: `${count} words: ${count} mod ${f.divisor} = ${count % f.divisor}, need ${f.residue}`,
        }
      return { ok: true }
    },
  },

  specific_position_letter: {
    describe: (f) =>
      `The ${ordinal(f.position)} alphabetic character in the text must be the letter "${f.letter.toUpperCase()}"`,
    verify: (prompt, f) => {
      const alphaChars = prompt.replace(/[^a-zA-Z]/g, '').toLowerCase()
      const idx = f.position - 1
      if (idx < 0 || idx >= alphaChars.length)
        return {
          ok: false,
          detail: `text has only ${alphaChars.length} alphabetic characters; position ${f.position} is out of range`,
        }
      const actual = alphaChars[idx]
      if (actual !== f.letter.toLowerCase())
        return {
          ok: false,
          detail: `alphabetic char #${f.position} is "${actual}", need "${f.letter.toLowerCase()}"`,
        }
      return { ok: true }
    },
  },

  word_length_at_index: {
    describe: (f) =>
      `The ${ordinal(f.index + 1)} word must be exactly ${f.length} characters long`,
    verify: (prompt, f) => {
      const ws = words(prompt)
      const target = ws[f.index]
      if (target === undefined)
        return { ok: false, detail: `fewer than ${f.index + 1} words in submission` }
      if (target.length !== f.length)
        return {
          ok: false,
          detail: `word ${f.index + 1} is "${target}" (${target.length} chars), need ${f.length}`,
        }
      return { ok: true }
    },
  },

  punctuation_count_exact: {
    describe: (f) =>
      `The text must contain exactly ${f.count} occurrence${f.count === 1 ? '' : 's'} of "${f.mark}"`,
    verify: (prompt, f) => {
      if (f.mark.length !== 1)
        return { ok: false, detail: `invalid form: mark must be exactly 1 character` }
      const actual = [...prompt].filter((c) => c === f.mark).length
      if (actual !== f.count)
        return {
          ok: false,
          detail: `found ${actual} occurrence${actual === 1 ? '' : 's'} of "${f.mark}", need ${f.count}`,
        }
      return { ok: true }
    },
  },

  first_letter_pattern: {
    describe: (f) =>
      `The first ${f.pattern.length} words must begin with letters matching the pattern "${f.pattern}" — C=consonant, V=vowel`,
    verify: (prompt, f) => {
      const invalid = [...f.pattern.toUpperCase()].find((c) => c !== 'C' && c !== 'V')
      if (invalid !== undefined)
        return { ok: false, detail: `invalid form: pattern character "${invalid}" is not C or V` }
      const ws = words(prompt)
      if (ws.length < f.pattern.length)
        return {
          ok: false,
          detail: `fewer than ${f.pattern.length} words; need at least ${f.pattern.length}`,
        }
      const vowels = new Set('aeiou')
      for (let i = 0; i < f.pattern.length; i++) {
        const expected = f.pattern[i].toUpperCase() as 'C' | 'V'
        const firstLetter = ws[i][0]
        const isVowel = vowels.has(firstLetter)
        const matches = (expected === 'V' && isVowel) || (expected === 'C' && !isVowel)
        if (!matches)
          return {
            ok: false,
            detail: `word ${i + 1} "${ws[i]}" starts with "${firstLetter}" (${isVowel ? 'vowel' : 'consonant'}), but pattern position ${i + 1} requires a ${expected === 'V' ? 'vowel' : 'consonant'}`,
          }
      }
      return { ok: true }
    },
  },

  word_at_index_matches: {
    describe: (f) =>
      `The ${ordinal(f.index + 1)} word must match the pattern /${f.regex}/i`,
    verify: (prompt, f) => {
      const ws = words(prompt)
      const target = ws[f.index]
      if (target === undefined)
        return { ok: false, detail: `fewer than ${f.index + 1} words in submission` }
      let re: RegExp
      try {
        re = new RegExp(f.regex, 'i')
      } catch {
        return { ok: false, detail: `invalid regex: ${f.regex}` }
      }
      if (!re.test(target))
        return { ok: false, detail: `word ${f.index + 1} "${target}" does not match /${f.regex}/i` }
      return { ok: true }
    },
  },

  no_word_at_index_starts_with: {
    describe: (f) =>
      `The ${ordinal(f.index + 1)} word must NOT start with the letter "${f.letter.toUpperCase()}"`,
    verify: (prompt, f) => {
      const ws = words(prompt)
      const target = ws[f.index]
      if (target === undefined)
        return { ok: false, detail: `fewer than ${f.index + 1} words in submission` }
      if (target[0] === f.letter.toLowerCase())
        return {
          ok: false,
          detail: `word ${f.index + 1} "${target}" starts with "${f.letter.toLowerCase()}"`,
        }
      return { ok: true }
    },
  },
}

// ─── Hard form handlers ───────────────────────────────────────────────────────

// [LAW:types-are-the-program] Same mapped-type exhaustiveness as EASY_FORMS.
const HARD_FORMS: { [K in HardForm['kind']]: FormHandler<Extract<HardForm, { kind: K }>> } = {
  lipogram: {
    describe: (f) =>
      `The text must not contain the letter "${f.forbidden.toUpperCase()}" anywhere — not a single instance`,
    verify: (prompt, f) => {
      if (f.forbidden.length !== 1 || !/^[a-zA-Z]$/.test(f.forbidden))
        return { ok: false, detail: `invalid form: forbidden must be exactly one alphabetic letter` }
      const forbidden = f.forbidden.toLowerCase()
      const idx = prompt.toLowerCase().indexOf(forbidden)
      if (idx !== -1)
        return {
          ok: false,
          detail: `forbidden letter "${forbidden}" found at position ${idx + 1}`,
        }
      return { ok: true }
    },
  },

  acrostic: {
    describe: (f) =>
      `The first letters of the first ${f.target.length} words must spell out "${f.target.toUpperCase()}"`,
    verify: (prompt, f) => {
      const ws = words(prompt)
      const target = f.target.toLowerCase()
      if (ws.length < target.length)
        return { ok: false, detail: `only ${ws.length} ${ws.length === 1 ? 'word' : 'words'}; need at least ${target.length}` }
      for (let i = 0; i < target.length; i++) {
        if (ws[i][0] !== target[i])
          return {
            ok: false,
            detail: `word ${i + 1} "${ws[i]}" starts with "${ws[i][0]}", need "${target[i]}" to spell "${f.target.toUpperCase()}"`,
          }
      }
      return { ok: true }
    },
  },

  every_word_unique_first_letter: {
    describe: (_f) => `Every word must begin with a different letter — no two words can share a starting letter`,
    verify: (prompt, _f) => {
      const ws = words(prompt)
      const seen = new Map<string, number>()
      for (let i = 0; i < ws.length; i++) {
        const first = ws[i][0]
        if (seen.has(first))
          return {
            ok: false,
            detail: `words "${ws[seen.get(first)!]}" (position ${seen.get(first)! + 1}) and "${ws[i]}" (position ${i + 1}) both start with "${first}"`,
          }
        seen.set(first, i)
      }
      return { ok: true }
    },
  },

  embedded_palindrome: {
    describe: (f) =>
      `The text must contain an embedded palindrome of at least ${f.minLength} alphabetic characters`,
    verify: (prompt, f) => {
      const alpha = prompt.replace(/[^a-zA-Z]/g, '').toLowerCase()
      const best = longestPalindrome(alpha)
      if (best < f.minLength)
        return {
          ok: false,
          detail: `longest embedded palindrome is ${best} characters, need at least ${f.minLength}`,
        }
      return { ok: true }
    },
  },

  pangram: {
    describe: (_f) => `The text must contain every letter of the alphabet at least once`,
    verify: (prompt, _f) => {
      const present = new Set(prompt.toLowerCase().replace(/[^a-z]/g, ''))
      const missing = 'abcdefghijklmnopqrstuvwxyz'.split('').filter((c) => !present.has(c))
      if (missing.length > 0)
        return { ok: false, detail: `missing letters: ${missing.join(', ')}` }
      return { ok: true }
    },
  },

  every_word_ends_with: {
    describe: (f) =>
      `Every word must end with "${f.suffix}" (case-insensitive)`,
    verify: (prompt, f) => {
      const ws = words(prompt)
      const suffix = f.suffix.toLowerCase()
      for (const w of ws) {
        if (!w.endsWith(suffix))
          return { ok: false, detail: `word "${w}" does not end with "${suffix}"` }
      }
      return { ok: true }
    },
  },

  word_lengths_strictly_increasing: {
    describe: (_f) =>
      `The length of each successive word must be strictly greater than the previous word`,
    verify: (prompt, _f) => {
      const ws = words(prompt)
      for (let i = 1; i < ws.length; i++) {
        if (ws[i].length <= ws[i - 1].length)
          return {
            ok: false,
            detail: `word ${i + 1} "${ws[i]}" (${ws[i].length} chars) is not longer than word ${i} "${ws[i - 1]}" (${ws[i - 1].length} chars)`,
          }
      }
      return { ok: true }
    },
  },

  no_word_repeats: {
    describe: (_f) => `No word may appear more than once (case-insensitive)`,
    verify: (prompt, _f) => {
      const ws = words(prompt)
      const seen = new Map<string, number>()
      for (let i = 0; i < ws.length; i++) {
        const w = ws[i]
        if (seen.has(w))
          return {
            ok: false,
            detail: `"${w}" appears at positions ${seen.get(w)! + 1} and ${i + 1}`,
          }
        seen.set(w, i)
      }
      return { ok: true }
    },
  },

  every_word_starts_same_letter: {
    describe: (f) =>
      `Every word must begin with the letter "${f.letter.toUpperCase()}" (case-insensitive)`,
    verify: (prompt, f) => {
      const ws = words(prompt)
      const letter = f.letter.toLowerCase()
      for (const w of ws) {
        if (w[0] !== letter)
          return { ok: false, detail: `word "${w}" does not start with "${letter}"` }
      }
      return { ok: true }
    },
  },

  haiku: {
    describe: (_f) =>
      `The text must be a haiku: three lines with exactly 5, 7, and 5 syllables. Use common words — the syllable counter requires recognized English vocabulary`,
    verify: (prompt, _f) => {
      const lines = prompt.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
      if (lines.length !== 3)
        return { ok: false, detail: `haiku requires exactly 3 lines; found ${lines.length}` }
      const expected = [5, 7, 5]
      for (let i = 0; i < 3; i++) {
        const result = countSyllables(lines[i])
        if ('oov' in result)
          return { ok: false, detail: `unrecognized word: ${result.oov}` }
        if (result.total !== expected[i])
          return {
            ok: false,
            detail: `line ${i + 1} has ${result.total} syllable${result.total === 1 ? '' : 's'}, need ${expected[i]}`,
          }
      }
      return { ok: true }
    },
  },

  monosyllabic: {
    describe: (_f) =>
      `Every word must be exactly one syllable. Use common monosyllabic words — the syllable counter requires recognized English vocabulary`,
    verify: (prompt, _f) => {
      const ws = words(prompt)
      for (const w of ws) {
        const seq = syllables(w)
        if (seq === null)
          return { ok: false, detail: `unrecognized word: ${w}` }
        if (seq.length !== 1)
          return { ok: false, detail: `"${w}" has ${seq.length} syllables, need 1` }
      }
      return { ok: true }
    },
  },

  iambic_pentameter: {
    // [LAW:types-are-the-program] The verifier checks syllable count only (10 per line),
    // not stress alternation. True iambic stress verification would reject many valid lines
    // due to lexical-vs-metrical stress divergence, causing undiagnosable false negatives.
    // The describe() states exactly what is verified so agents know the actual rule.
    describe: (f) =>
      `The text must be exactly ${f.lines} line${f.lines === 1 ? '' : 's'}, each with exactly 10 syllables (iambic pentameter line length). Use common words — the syllable counter requires recognized English vocabulary`,
    verify: (prompt, f) => {
      const lines = prompt.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
      if (lines.length !== f.lines)
        return {
          ok: false,
          detail: `need exactly ${f.lines} line${f.lines === 1 ? '' : 's'}; found ${lines.length}`,
        }
      for (let i = 0; i < lines.length; i++) {
        const result = countSyllables(lines[i])
        if ('oov' in result)
          return { ok: false, detail: `unrecognized word: ${result.oov}` }
        if (result.total !== 10)
          return {
            ok: false,
            detail: `line ${i + 1} has ${result.total} syllable${result.total === 1 ? '' : 's'}, need 10`,
          }
      }
      return { ok: true }
    },
  },
}

// ─── Dispatchers ─────────────────────────────────────────────────────────────

// [LAW:dataflow-not-control-flow] switch on discriminator; variability lives
// in the form value, not in which checks execute.
export function verifyEasy(prompt: string, f: EasyForm): VerifyResult {
  switch (f.kind) {
    case 'nth_word_from_end_has_length':
      return EASY_FORMS.nth_word_from_end_has_length.verify(prompt, f)
    case 'word_count_modulo':
      return EASY_FORMS.word_count_modulo.verify(prompt, f)
    case 'specific_position_letter':
      return EASY_FORMS.specific_position_letter.verify(prompt, f)
    case 'word_length_at_index':
      return EASY_FORMS.word_length_at_index.verify(prompt, f)
    case 'punctuation_count_exact':
      return EASY_FORMS.punctuation_count_exact.verify(prompt, f)
    case 'first_letter_pattern':
      return EASY_FORMS.first_letter_pattern.verify(prompt, f)
    case 'word_at_index_matches':
      return EASY_FORMS.word_at_index_matches.verify(prompt, f)
    case 'no_word_at_index_starts_with':
      return EASY_FORMS.no_word_at_index_starts_with.verify(prompt, f)
    default:
      return assertNever(f)
  }
}

export function describeEasy(f: EasyForm): string {
  switch (f.kind) {
    case 'nth_word_from_end_has_length':
      return EASY_FORMS.nth_word_from_end_has_length.describe(f)
    case 'word_count_modulo':
      return EASY_FORMS.word_count_modulo.describe(f)
    case 'specific_position_letter':
      return EASY_FORMS.specific_position_letter.describe(f)
    case 'word_length_at_index':
      return EASY_FORMS.word_length_at_index.describe(f)
    case 'punctuation_count_exact':
      return EASY_FORMS.punctuation_count_exact.describe(f)
    case 'first_letter_pattern':
      return EASY_FORMS.first_letter_pattern.describe(f)
    case 'word_at_index_matches':
      return EASY_FORMS.word_at_index_matches.describe(f)
    case 'no_word_at_index_starts_with':
      return EASY_FORMS.no_word_at_index_starts_with.describe(f)
    default:
      return assertNever(f)
  }
}

export function verifyHard(prompt: string, f: HardForm): VerifyResult {
  switch (f.kind) {
    case 'lipogram':
      return HARD_FORMS.lipogram.verify(prompt, f)
    case 'acrostic':
      return HARD_FORMS.acrostic.verify(prompt, f)
    case 'every_word_unique_first_letter':
      return HARD_FORMS.every_word_unique_first_letter.verify(prompt, f)
    case 'embedded_palindrome':
      return HARD_FORMS.embedded_palindrome.verify(prompt, f)
    case 'pangram':
      return HARD_FORMS.pangram.verify(prompt, f)
    case 'every_word_ends_with':
      return HARD_FORMS.every_word_ends_with.verify(prompt, f)
    case 'word_lengths_strictly_increasing':
      return HARD_FORMS.word_lengths_strictly_increasing.verify(prompt, f)
    case 'no_word_repeats':
      return HARD_FORMS.no_word_repeats.verify(prompt, f)
    case 'every_word_starts_same_letter':
      return HARD_FORMS.every_word_starts_same_letter.verify(prompt, f)
    case 'haiku':
      return HARD_FORMS.haiku.verify(prompt, f)
    case 'monosyllabic':
      return HARD_FORMS.monosyllabic.verify(prompt, f)
    case 'iambic_pentameter':
      return HARD_FORMS.iambic_pentameter.verify(prompt, f)
    default:
      return assertNever(f)
  }
}

export function describeHard(f: HardForm): string {
  switch (f.kind) {
    case 'lipogram':
      return HARD_FORMS.lipogram.describe(f)
    case 'acrostic':
      return HARD_FORMS.acrostic.describe(f)
    case 'every_word_unique_first_letter':
      return HARD_FORMS.every_word_unique_first_letter.describe(f)
    case 'embedded_palindrome':
      return HARD_FORMS.embedded_palindrome.describe(f)
    case 'pangram':
      return HARD_FORMS.pangram.describe(f)
    case 'every_word_ends_with':
      return HARD_FORMS.every_word_ends_with.describe(f)
    case 'word_lengths_strictly_increasing':
      return HARD_FORMS.word_lengths_strictly_increasing.describe(f)
    case 'no_word_repeats':
      return HARD_FORMS.no_word_repeats.describe(f)
    case 'every_word_starts_same_letter':
      return HARD_FORMS.every_word_starts_same_letter.describe(f)
    case 'haiku':
      return HARD_FORMS.haiku.describe(f)
    case 'monosyllabic':
      return HARD_FORMS.monosyllabic.describe(f)
    case 'iambic_pentameter':
      return HARD_FORMS.iambic_pentameter.describe(f)
    default:
      return assertNever(f)
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0])
}

// Center-expansion palindrome search: O(n²) worst case, adequate for prompt strings ≤500 chars.
function longestPalindrome(s: string): number {
  if (s.length === 0) return 0
  let best = 1
  for (let center = 0; center < s.length; center++) {
    // Odd-length palindromes
    let r = 0
    while (center - r - 1 >= 0 && center + r + 1 < s.length && s[center - r - 1] === s[center + r + 1])
      r++
    best = Math.max(best, 2 * r + 1)
    // Even-length palindromes
    if (center + 1 < s.length && s[center] === s[center + 1]) {
      let re = 0
      while (center - re - 1 >= 0 && center + re + 2 < s.length && s[center - re - 1] === s[center + re + 2])
        re++
      best = Math.max(best, 2 * re + 2)
    }
  }
  return best
}
