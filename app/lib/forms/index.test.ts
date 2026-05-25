import { describe, expect, it } from 'vitest'
import {
  describeEasy,
  describeHard,
  verifyEasy,
  verifyHard,
  type EasyForm,
  type HardForm,
} from './index'

// ─── EasyForm tests ───────────────────────────────────────────────────────────

describe('EasyForm: nth_word_from_end_has_length', () => {
  const f: EasyForm = { kind: 'nth_word_from_end_has_length', n: 1, length: 5 }

  it('passes when last word has correct length', () => {
    expect(verifyEasy('hello world ocean', f)).toEqual({ ok: true })
  })

  it('fails when last word has wrong length', () => {
    const r = verifyEasy('hello world cat', f)  // "cat" = 3 chars, needs 5
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('"cat"')
  })

  it('fails when there are fewer words than n', () => {
    const r = verifyEasy('ocean', { kind: 'nth_word_from_end_has_length', n: 2, length: 5 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('fewer than 2 words')
  })

  it('handles n=2 (second-to-last)', () => {
    expect(verifyEasy('quick brown fox', { kind: 'nth_word_from_end_has_length', n: 2, length: 5 })).toEqual({ ok: true })
  })

  it('describe returns non-empty string', () => {
    expect(describeEasy(f).length).toBeGreaterThan(0)
  })
})

describe('EasyForm: word_count_modulo', () => {
  const f: EasyForm = { kind: 'word_count_modulo', divisor: 3, residue: 1 }

  it('passes when word count mod divisor equals residue (4 mod 3 = 1)', () => {
    expect(verifyEasy('one two three four', f)).toEqual({ ok: true })
  })

  it('fails when modulo does not match (3 mod 3 = 0)', () => {
    const r = verifyEasy('one two three', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('mod 3')
  })

  it('edge case: 1 word satisfies residue=1', () => {
    expect(verifyEasy('word', f)).toEqual({ ok: true })
  })

  it('describe returns non-empty string', () => {
    expect(describeEasy(f).length).toBeGreaterThan(0)
  })
})

describe('EasyForm: specific_position_letter', () => {
  const f: EasyForm = { kind: 'specific_position_letter', position: 1, letter: 'h' }

  it('passes when alphabetic char at position matches', () => {
    // "Hello world" → alpha chars = "Helloworld" → position 1 = 'h'
    expect(verifyEasy('Hello world', f)).toEqual({ ok: true })
  })

  it('fails when alphabetic char at position does not match', () => {
    const r = verifyEasy('World hello', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('"w"')
  })

  it('fails when position is out of range', () => {
    const r = verifyEasy('hi', { kind: 'specific_position_letter', position: 10, letter: 'x' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('out of range')
  })

  it('is case-insensitive', () => {
    expect(verifyEasy('HELLO', { kind: 'specific_position_letter', position: 1, letter: 'H' })).toEqual({ ok: true })
  })

  it('describe returns non-empty string', () => {
    expect(describeEasy(f).length).toBeGreaterThan(0)
  })
})

describe('EasyForm: word_length_at_index', () => {
  const f: EasyForm = { kind: 'word_length_at_index', index: 0, length: 5 }

  it('passes when word at index has correct length', () => {
    expect(verifyEasy('hello world', f)).toEqual({ ok: true })
  })

  it('fails when word at index has wrong length', () => {
    const r = verifyEasy('hi world', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('"hi"')
  })

  it('fails when index is out of range', () => {
    const r = verifyEasy('one', { kind: 'word_length_at_index', index: 5, length: 3 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('fewer than 6 words')
  })

  it('works for middle-of-sentence index', () => {
    expect(verifyEasy('a bb ccc dddd', { kind: 'word_length_at_index', index: 2, length: 3 })).toEqual({ ok: true })
  })

  it('describe returns non-empty string', () => {
    expect(describeEasy(f).length).toBeGreaterThan(0)
  })
})

describe('EasyForm: punctuation_count_exact', () => {
  const f: EasyForm = { kind: 'punctuation_count_exact', mark: ',', count: 2 }

  it('passes when punctuation count matches', () => {
    expect(verifyEasy('one, two, three', f)).toEqual({ ok: true })
  })

  it('fails when count is wrong', () => {
    const r = verifyEasy('one, two', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('1 occurrence')
  })

  it('passes with count=0 on punctuation-free text', () => {
    expect(verifyEasy('no punctuation here', { kind: 'punctuation_count_exact', mark: '.', count: 0 })).toEqual({ ok: true })
  })

  it('fails when there are extra punctuation marks', () => {
    const r = verifyEasy('one, two, three, four', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('3 occurrences')
  })

  it('describe returns non-empty string', () => {
    expect(describeEasy(f).length).toBeGreaterThan(0)
  })
})

describe('EasyForm: first_letter_pattern', () => {
  const f: EasyForm = { kind: 'first_letter_pattern', pattern: 'CVCV' }

  it('passes when first letters match pattern (big apple is over)', () => {
    // b=C, a=V, i=V... no, let me think: b=C, a=V, p=C (big=C, apple=V, is=V, over=V)
    // Need CVCV: word1=consonant, word2=vowel, word3=consonant, word4=vowel
    // "Red apple runs over" → R=C, a=V, r=C, o=V ✓
    expect(verifyEasy('Red apple runs over', f)).toEqual({ ok: true })
  })

  it('fails when pattern does not match', () => {
    // "Apple red over runs" → A=V, r=C... violates CVCV (needs C first)
    const r = verifyEasy('Apple red over runs', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('vowel')
  })

  it('fails when fewer words than pattern length', () => {
    const r = verifyEasy('Red apple', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('fewer than 4 words')
  })

  it('allows extra words beyond pattern length', () => {
    // Extra words after pattern are ignored
    expect(verifyEasy('Big apple runs over the fence today', f)).toEqual({ ok: true })
  })

  it('describe returns non-empty string', () => {
    expect(describeEasy(f).length).toBeGreaterThan(0)
  })
})

describe('EasyForm: word_at_index_matches', () => {
  const f: EasyForm = { kind: 'word_at_index_matches', index: 1, regex: '^[aeiou]' }

  it('passes when word at index matches regex', () => {
    expect(verifyEasy('the ocean waves', f)).toEqual({ ok: true })
  })

  it('fails when word does not match', () => {
    const r = verifyEasy('the cat sat', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('"cat"')
  })

  it('fails when index out of range', () => {
    const r = verifyEasy('one', { kind: 'word_at_index_matches', index: 5, regex: '.*' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('fewer than 6 words')
  })

  it('handles invalid regex gracefully', () => {
    const r = verifyEasy('hello world', { kind: 'word_at_index_matches', index: 0, regex: '(unclosed' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('invalid regex')
  })

  it('describe returns non-empty string', () => {
    expect(describeEasy(f).length).toBeGreaterThan(0)
  })
})

describe('EasyForm: no_word_at_index_starts_with', () => {
  const f: EasyForm = { kind: 'no_word_at_index_starts_with', index: 0, letter: 't' }

  it('passes when word does not start with forbidden letter', () => {
    expect(verifyEasy('big cat sat', f)).toEqual({ ok: true })
  })

  it('fails when word starts with forbidden letter', () => {
    const r = verifyEasy('the cat sat', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('"the"')
  })

  it('fails when index out of range', () => {
    const r = verifyEasy('one', { kind: 'no_word_at_index_starts_with', index: 5, letter: 'a' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('fewer than 6 words')
  })

  it('is case-insensitive', () => {
    const r = verifyEasy('The cat sat', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('"the"')
  })

  it('describe returns non-empty string', () => {
    expect(describeEasy(f).length).toBeGreaterThan(0)
  })
})

// ─── HardForm tests ───────────────────────────────────────────────────────────

describe('HardForm: lipogram', () => {
  const f: HardForm = { kind: 'lipogram', forbidden: 'e' }

  it('passes when forbidden letter is absent', () => {
    // Classic lipogram avoiding 'e': "A joyful fox sat with calm air"
    expect(verifyHard('a quick brown fox naps', f)).toEqual({ ok: true })
  })

  it('fails when forbidden letter appears', () => {
    const r = verifyHard('the quick brown fox', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('"e"')
  })

  it('is case-insensitive', () => {
    const r = verifyHard('Every word', f)
    expect(r.ok).toBe(false)
  })

  it('passes an empty string', () => {
    expect(verifyHard('', f)).toEqual({ ok: true })
  })

  it('describe returns non-empty string', () => {
    expect(describeHard(f).length).toBeGreaterThan(0)
  })
})

describe('HardForm: acrostic', () => {
  const f: HardForm = { kind: 'acrostic', target: 'CAT' }

  it('passes when first letters spell target', () => {
    expect(verifyHard('Colorful and tasty', f)).toEqual({ ok: true })
  })

  it('fails when first letters do not spell target', () => {
    const r = verifyHard('Colorful big tasty', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('"b"')
  })

  it('fails when there are fewer words than target length', () => {
    const r = verifyHard('Cat', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('only 1 words')
  })

  it('allows extra words after target length', () => {
    expect(verifyHard('Colorful and tasty food is wonderful', f)).toEqual({ ok: true })
  })

  it('is case-insensitive', () => {
    expect(verifyHard('colorful and tasty', f)).toEqual({ ok: true })
  })

  it('describe returns non-empty string', () => {
    expect(describeHard(f).length).toBeGreaterThan(0)
  })
})

describe('HardForm: every_word_unique_first_letter', () => {
  const f: HardForm = { kind: 'every_word_unique_first_letter' }

  it('passes when all words start with different letters', () => {
    expect(verifyHard('big cat dog eats fish', f)).toEqual({ ok: true })
  })

  it('fails when two words share a starting letter', () => {
    const r = verifyHard('big cat dog eats fox fish', f)  // fox and fish both start with f
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('"fish"')
  })

  it('passes with a single word', () => {
    expect(verifyHard('hello', f)).toEqual({ ok: true })
  })

  it('is case-insensitive', () => {
    const r = verifyHard('Big cat Dog eats Fox', f)
    // b, c, d, e, f — all unique, should pass
    expect(r.ok).toBe(true)
  })

  it('describe returns non-empty string', () => {
    expect(describeHard(f).length).toBeGreaterThan(0)
  })
})

describe('HardForm: embedded_palindrome', () => {
  const f: HardForm = { kind: 'embedded_palindrome', minLength: 5 }

  it('passes when text contains a palindrome of sufficient length', () => {
    expect(verifyHard('I drove the racecar fast', f)).toEqual({ ok: true })
  })

  it('fails when no palindrome of sufficient length exists', () => {
    const r = verifyHard('the cat sat on a mat', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('5')
  })

  it('passes with a word-embedded palindrome (level)', () => {
    expect(verifyHard('the level bridge stands', f)).toEqual({ ok: true })
  })

  it('minLength=3 passes on most text (short palindromes abound)', () => {
    expect(verifyHard('a man with radar', { kind: 'embedded_palindrome', minLength: 5 })).toEqual({ ok: true })
  })

  it('edge case: single-char text has palindrome of length 1', () => {
    const r = verifyHard('a', { kind: 'embedded_palindrome', minLength: 3 })
    expect(r.ok).toBe(false)
  })

  it('describe returns non-empty string', () => {
    expect(describeHard(f).length).toBeGreaterThan(0)
  })
})

describe('HardForm: pangram', () => {
  const f: HardForm = { kind: 'pangram' }

  it('passes on a classic pangram', () => {
    expect(verifyHard('the quick brown fox jumps over the lazy dog', f)).toEqual({ ok: true })
  })

  it('fails when letters are missing', () => {
    const r = verifyHard('the quick brown fox jumps over the lazy cat', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('d')
  })

  it('is case-insensitive', () => {
    expect(verifyHard('THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG', f)).toEqual({ ok: true })
  })

  it('fails on short text', () => {
    const r = verifyHard('hello', f)
    expect(r.ok).toBe(false)
  })

  it('describe returns non-empty string', () => {
    expect(describeHard(f).length).toBeGreaterThan(0)
  })
})

describe('HardForm: every_word_ends_with', () => {
  const f: HardForm = { kind: 'every_word_ends_with', suffix: 'ing' }

  it('passes when all words end with suffix', () => {
    expect(verifyHard('running jumping swimming flying', f)).toEqual({ ok: true })
  })

  it('fails when any word does not end with suffix', () => {
    const r = verifyHard('running jumping and flying', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('"and"')
  })

  it('is case-insensitive', () => {
    expect(verifyHard('Running Jumping Swimming', f)).toEqual({ ok: true })
  })

  it('works with single-char suffix', () => {
    expect(verifyHard('the tree scene', { kind: 'every_word_ends_with', suffix: 'e' })).toEqual({ ok: true })
  })

  it('describe returns non-empty string', () => {
    expect(describeHard(f).length).toBeGreaterThan(0)
  })
})

describe('HardForm: word_lengths_strictly_increasing', () => {
  const f: HardForm = { kind: 'word_lengths_strictly_increasing' }

  it('passes when word lengths are strictly increasing', () => {
    expect(verifyHard('I am the best world', f)).toEqual({ ok: true })  // 1,2,3,4,5
  })

  it('fails when a word is not longer than previous', () => {
    const r = verifyHard('I am the cats sat', f)  // sat(3) < cats(4) → fails
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('"sat"')
  })

  it('fails on equal lengths', () => {
    const r = verifyHard('cat sat mat', f)
    expect(r.ok).toBe(false)
  })

  it('passes with a single word', () => {
    expect(verifyHard('hello', f)).toEqual({ ok: true })
  })

  it('describe returns non-empty string', () => {
    expect(describeHard(f).length).toBeGreaterThan(0)
  })
})

describe('HardForm: no_word_repeats', () => {
  const f: HardForm = { kind: 'no_word_repeats' }

  it('passes when all words are distinct', () => {
    expect(verifyHard('the quick brown fox', f)).toEqual({ ok: true })
  })

  it('fails when a word appears twice', () => {
    const r = verifyHard('the quick brown the fox', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('"the"')
  })

  it('is case-insensitive', () => {
    const r = verifyHard('The quick brown THE fox', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('"the"')
  })

  it('passes with a single word', () => {
    expect(verifyHard('hello', f)).toEqual({ ok: true })
  })

  it('describe returns non-empty string', () => {
    expect(describeHard(f).length).toBeGreaterThan(0)
  })
})

describe('HardForm: every_word_starts_same_letter', () => {
  const f: HardForm = { kind: 'every_word_starts_same_letter', letter: 'p' }

  it('passes when all words start with the same letter', () => {
    expect(verifyHard('purple penguins paddle past piers', f)).toEqual({ ok: true })
  })

  it('fails when any word does not start with the letter', () => {
    const r = verifyHard('purple penguins dance past piers', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('"dance"')
  })

  it('is case-insensitive', () => {
    expect(verifyHard('Purple Penguins Paddle Past', f)).toEqual({ ok: true })
  })

  it('passes with empty string (no words to violate)', () => {
    expect(verifyHard('', f)).toEqual({ ok: true })
  })

  it('describe returns non-empty string', () => {
    expect(describeHard(f).length).toBeGreaterThan(0)
  })
})

// ─── Dictionary-backed HardForm tests ────────────────────────────────────────

describe('HardForm: haiku', () => {
  const f: HardForm = { kind: 'haiku' }

  it('passes on a valid 5-7-5 haiku', () => {
    // "old pond" (2) "a frog jumps in" (5) "sound of water" (4) — classic Basho
    // Let me construct one that works with CMU dict:
    // Line 1 (5 syl): "cat sits on the sill" → cat(1)+sits(1)+on(1)+the(1)+sill(1) = 5 ✓
    // Line 2 (7 syl): "watching birds fly past the pane" → watch(1)+ing(1)+birds(1)+fly(1)+past(1)+the(1)+pane(1) = 7 ✓
    // Wait, "watching" = watch+ing = 2 syllables. Let me recalculate:
    // "watching birds fly past the pane" = watch-ing(2) birds(1) fly(1) past(1) the(1) pane(1) = 7 ✓
    // Line 3 (5 syl): "still as stone it waits" → still(1)+as(1)+stone(1)+it(1)+waits(1) = 5 ✓
    const haiku = 'cat sits on the sill\nwatching birds fly past the pane\nstill as stone it waits'
    expect(verifyHard(haiku, f)).toEqual({ ok: true })
  })

  it('fails when lines have wrong syllable counts', () => {
    const r = verifyHard('hello world today\nthis is a test sentence here\ncat sat on mat', f)
    expect(r.ok).toBe(false)
  })

  it('fails when text has wrong number of lines', () => {
    const r = verifyHard('only one line here', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('3 lines')
  })

  it('fails on OOV word', () => {
    const r = verifyHard('xqzrplm sits now\nwatching birds fly past the pane\nstill as stone it waits', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('unrecognized word')
  })

  it('fails when line 2 does not have 7 syllables', () => {
    // Line 2 with 5 syllables instead of 7
    const r = verifyHard('cat sits on the sill\nbirds fly past now\nstill as stone it waits', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('line 2')
  })

  it('describe returns non-empty string', () => {
    expect(describeHard(f).length).toBeGreaterThan(0)
  })
})

describe('HardForm: monosyllabic', () => {
  const f: HardForm = { kind: 'monosyllabic' }

  it('passes when all words are monosyllabic', () => {
    expect(verifyHard('the cat sat on the mat', f)).toEqual({ ok: true })
  })

  it('fails when any word is multisyllabic', () => {
    const r = verifyHard('the beautiful cat sat', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('"beautiful"')
  })

  it('fails on OOV word', () => {
    const r = verifyHard('xqzrplm cat sat', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('unrecognized word: xqzrplm')
  })

  it('passes with contractions', () => {
    // "don't" = 1 syllable in CMU
    expect(verifyHard("don't stop", f)).toEqual({ ok: true })
  })

  it('describe returns non-empty string', () => {
    expect(describeHard(f).length).toBeGreaterThan(0)
  })
})

describe('HardForm: iambic_pentameter', () => {
  const f: HardForm = { kind: 'iambic_pentameter', lines: 2 }

  it('passes when each line has exactly 10 syllables', () => {
    // Line 1 (10 syl): "shall I com-pare thee to a sum-mer's day" = shall(1)+I(1)+com-pare(2)+thee(1)+to(1)+a(1)+sum-mer's(2)+day(1) = 10
    // But "summer's" might be in CMU... let me use simpler words
    // "the cat sat on the mat by the big tree" = the(1)+cat(1)+sat(1)+on(1)+the(1)+mat(1)+by(1)+the(1)+big(1)+tree(1) = 10 ✓
    // "a dog ran fast and leapt up on the wall" = a(1)+dog(1)+ran(1)+fast(1)+and(1)+leapt(1)+up(1)+on(1)+the(1)+wall(1) = 10 ✓
    const text = 'the cat sat on the mat by the big tree\na dog ran fast and leapt up on the wall'
    expect(verifyHard(text, f)).toEqual({ ok: true })
  })

  it('fails when a line has wrong syllable count', () => {
    const r = verifyHard('the cat sat\nthe dog ran fast', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('10')
  })

  it('fails when line count does not match', () => {
    const r = verifyHard('the cat sat on the mat by the big tree', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('2 lines')
  })

  it('fails on OOV word', () => {
    const r = verifyHard('the xqzrplm sat on the mat by the big tree\na dog ran fast and leapt up on the wall', f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.detail).toContain('unrecognized word')
  })

  it('works for lines=1', () => {
    expect(verifyHard('the cat sat on the mat by the big tree', { kind: 'iambic_pentameter', lines: 1 })).toEqual({ ok: true })
  })

  it('describe returns non-empty string', () => {
    expect(describeHard(f).length).toBeGreaterThan(0)
  })
})

// ─── Exhaustiveness regression guard ─────────────────────────────────────────

describe('dispatchers handle all variants without throwing', () => {
  const easyForms: EasyForm[] = [
    { kind: 'nth_word_from_end_has_length', n: 1, length: 3 },
    { kind: 'word_count_modulo', divisor: 2, residue: 0 },
    { kind: 'specific_position_letter', position: 1, letter: 'a' },
    { kind: 'word_length_at_index', index: 0, length: 3 },
    { kind: 'punctuation_count_exact', mark: '.', count: 0 },
    { kind: 'first_letter_pattern', pattern: 'CC' },
    { kind: 'word_at_index_matches', index: 0, regex: '.*' },
    { kind: 'no_word_at_index_starts_with', index: 0, letter: 'z' },
  ]

  const hardForms: HardForm[] = [
    { kind: 'lipogram', forbidden: 'z' },
    { kind: 'acrostic', target: 'AB' },
    { kind: 'every_word_unique_first_letter' },
    { kind: 'embedded_palindrome', minLength: 3 },
    { kind: 'pangram' },
    { kind: 'every_word_ends_with', suffix: 'x' },
    { kind: 'word_lengths_strictly_increasing' },
    { kind: 'no_word_repeats' },
    { kind: 'every_word_starts_same_letter', letter: 'a' },
    { kind: 'haiku' },
    { kind: 'monosyllabic' },
    { kind: 'iambic_pentameter', lines: 1 },
  ]

  it('verifyEasy does not throw for any variant', () => {
    for (const f of easyForms) {
      expect(() => verifyEasy('test prompt', f)).not.toThrow()
    }
  })

  it('describeEasy returns non-empty for all variants', () => {
    for (const f of easyForms) {
      expect(describeEasy(f).length).toBeGreaterThan(0)
    }
  })

  it('verifyHard does not throw for any variant', () => {
    for (const f of hardForms) {
      expect(() => verifyHard('test prompt cats dogs run play', f)).not.toThrow()
    }
  })

  it('describeHard returns non-empty for all variants', () => {
    for (const f of hardForms) {
      expect(describeHard(f).length).toBeGreaterThan(0)
    }
  })
})
