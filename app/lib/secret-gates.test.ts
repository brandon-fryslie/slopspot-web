import { describe, expect, it } from 'vitest'
import { runSecretGates, SECRET_GATES } from './secret-gates'

// ─── wordCountBounds ─────────────────────────────────────────────────────────

describe('wordCountBounds gate', () => {
  const gate = SECRET_GATES.find((g) => g.id === 'word_count_bounds')!

  it('passes a prompt with 5 words', () => {
    expect(gate.check('a beautiful red old cat')).toEqual({ ok: true })
  })

  it('passes a prompt with many words', () => {
    expect(gate.check(Array(50).fill('word').join(' '))).toEqual({ ok: true })
  })

  it('passes exactly at the upper boundary (500 words)', () => {
    expect(gate.check(Array(500).fill('the').join(' '))).toEqual({ ok: true })
  })

  it('fails with 4 words (below minimum)', () => {
    expect(gate.check('a b c d')).toEqual({ ok: false })
  })

  it('fails with 3 words', () => {
    expect(gate.check('paint a sky')).toEqual({ ok: false })
  })

  it('fails with 501 words (above maximum)', () => {
    expect(gate.check(Array(501).fill('the').join(' '))).toEqual({ ok: false })
  })
})

// ─── alphaCharRatio ───────────────────────────────────────────────────────────

describe('alphaCharRatio gate', () => {
  const gate = SECRET_GATES.find((g) => g.id === 'alpha_char_ratio')!

  it('passes natural English text', () => {
    expect(gate.check('a beautiful mountain at sunset')).toEqual({ ok: true })
  })

  it('passes text with some punctuation', () => {
    // "hello, world! fine. good." — 22 chars, 19 alpha = 0.86
    expect(gate.check('hello, world! fine. good.')).toEqual({ ok: true })
  })

  it('fails text dominated by numbers and symbols', () => {
    // 5 alpha out of ~52 chars ≈ 0.44
    expect(gate.check('hello world good fine great !!!!!!!!!!!!!!!!!!!!!!')).toEqual({ ok: false })
  })

  it('fails pure symbols', () => {
    expect(gate.check('!!! ### $$$ %%% ^^^')).toEqual({ ok: false })
  })

  it('fails empty string', () => {
    expect(gate.check('')).toEqual({ ok: false })
  })

  it('passes at just above 70% alpha threshold', () => {
    // 7 alpha + 3 non-alpha chars = 70% exactly (>=0.70 passes)
    expect(gate.check('abcdefg!!!')).toEqual({ ok: true })
  })

  it('fails just below 70% alpha threshold', () => {
    // 6 alpha + 4 non-alpha = 60%
    expect(gate.check('abcdef!!!!')).toEqual({ ok: false })
  })
})

// ─── maxWordLength ────────────────────────────────────────────────────────────

describe('maxWordLength gate', () => {
  const gate = SECRET_GATES.find((g) => g.id === 'max_word_length')!

  it('passes natural text with moderate word lengths', () => {
    expect(gate.check('a beautiful landscape at golden hour')).toEqual({ ok: true })
  })

  it('passes a word at exactly 30 characters', () => {
    const word30 = 'a'.repeat(30) // 30-char word
    expect(gate.check(`beautiful ${word30} painting`)).toEqual({ ok: true })
  })

  it('fails a word at 31 characters', () => {
    const word31 = 'a'.repeat(31)
    expect(gate.check(`beautiful ${word31} painting`)).toEqual({ ok: false })
  })

  it('fails a very long concatenated word', () => {
    // 32-char nonsense word
    expect(gate.check('beautiful scene with supercalifragilisticexpialidocio painting art')).toEqual({ ok: false })
  })

  it('passes with an empty prompt (no words → no word too long)', () => {
    expect(gate.check('')).toEqual({ ok: true })
  })
})

// ─── dictionaryWordRatio ──────────────────────────────────────────────────────

describe('dictionaryWordRatio gate', () => {
  const gate = SECRET_GATES.find((g) => g.id === 'dictionary_word_ratio')!

  it('passes natural creative-writing text', () => {
    expect(gate.check('a majestic mountain landscape at sunset with dramatic clouds')).toEqual({ ok: true })
  })

  it('passes text with common contractions', () => {
    expect(gate.check("it's a beautiful day and the cat's meowing softly in the warm sun")).toEqual({ ok: true })
  })

  it('fails all-gibberish tokens', () => {
    expect(gate.check('zrgph blorf xyxzq wumbo flarg qzxpvb mfgrt blorch frumple zorfak')).toEqual({ ok: false })
  })

  it('fails when more than 10% of words are unknown', () => {
    // 11 words; 6 gibberish = 55% unknown → ratio 0.45
    expect(gate.check('the beautiful zrgph blorf xyxzq wumbo flarg is very nice here')).toEqual({ ok: false })
  })

  it('passes at exactly 90% known (9/10 words known)', () => {
    // 9 real words + 1 gibberish = 90% known
    expect(gate.check('a beautiful red old cat sits on the mat zrgph')).toEqual({ ok: true })
  })

  it('fails at 80% known (8/10 words known)', () => {
    // 8 real words + 2 gibberish
    expect(gate.check('a beautiful red old cat sits on the zrgph blorf')).toEqual({ ok: false })
  })
})

// ─── runSecretGates ───────────────────────────────────────────────────────────

describe('runSecretGates', () => {
  it('returns ok:true for a natural prompt', () => {
    expect(runSecretGates('a majestic mountain at sunset with golden light and dramatic clouds')).toEqual({
      ok: true,
    })
  })

  it('returns the first failing gate id, not a later one', () => {
    // 3 words → wordCountBounds fires first (before alphaCharRatio or dictionaryWordRatio)
    const result = runSecretGates('hi there')
    expect(result).toEqual({ ok: false, gate: 'word_count_bounds' })
  })

  it('returns word_count_bounds for too-long prompt', () => {
    const result = runSecretGates(Array(501).fill('the').join(' '))
    expect(result).toEqual({ ok: false, gate: 'word_count_bounds' })
  })

  it('returns alpha_char_ratio for symbol-heavy prompt with enough words', () => {
    // 5 real words + heavy punctuation suffix → alpha fails; word_count passes
    const result = runSecretGates('hello world good fine great !!!!!!!!!!!!!!!!!!!!!!')
    expect(result).toEqual({ ok: false, gate: 'alpha_char_ratio' })
  })

  it('returns max_word_length for a prompt with one very long word', () => {
    // 6 words, good alpha, one 32-char token → maxWordLength fires before dictRatio
    const result = runSecretGates('beautiful scene with supercalifragilisticexpialidocio painting art')
    expect(result).toEqual({ ok: false, gate: 'max_word_length' })
  })

  it('returns dictionary_word_ratio for all-gibberish prompt', () => {
    const result = runSecretGates('zrgph blorf xyxzq wumbo flarg qzxpvb mfgrt blorch frumple zorfak')
    expect(result).toEqual({ ok: false, gate: 'dictionary_word_ratio' })
  })
})

// ─── Natural prompt corpus: all must pass ─────────────────────────────────────

describe('natural prompts — all must pass all gates', () => {
  const prompts = [
    'A majestic mountain landscape at sunset with dramatic clouds reflected in a still lake',
    'A neon-lit cyberpunk city street at night with rain-slicked pavement and holographic advertisements',
    'An ancient library with towering wooden shelves lined with leather-bound books dusty sunbeams filtering through stained glass',
    'A futuristic metropolis seen from above with gleaming skyscrapers and winding rivers of light',
    'A lone figure standing on a cliff overlooking a stormy ocean with waves crashing below',
    'A dreamy watercolor painting of cherry blossoms falling over a peaceful Japanese garden',
    'An ethereal forest bathed in golden morning light with mist rising from the undergrowth',
    'A surreal landscape of floating islands connected by rope bridges under a violet sky',
    'A close-up portrait of a weathered old sailor with deep blue eyes and a salt-and-pepper beard',
    'A vibrant marketplace in a bustling medieval city with colorful banners and crowded stalls',
    'Abstract geometric shapes in vivid primary colors arranged in a bold modernist composition',
    'A haunted mansion on a hill silhouetted against a full moon with bats circling overhead',
    'A serene beach at dawn with golden sand pale blue water and a single fishing boat on the horizon',
    'A microscopic view of crystalline ice formations with intricate fractal patterns',
    'A sprawling fantasy city built into the side of a massive cliff with waterfalls cascading down',
    'Bioluminescent jellyfish drifting through the deep ocean surrounded by glowing particles',
    'A steampunk clockwork dragon with brass gears and copper wings breathing fire',
    'A minimalist zen garden with raked sand a single stone and the shadow of bamboo',
    'A photorealistic portrait of a fierce warrior queen wearing elaborate ceremonial armor',
    'A vintage poster illustration of a rocket launching toward a ringed planet in deep space',
    'An oil painting in the style of the Dutch Golden Age depicting a kitchen still life with vegetables and pewter pots',
    'A sweeping aerial view of terraced rice paddies glowing green in soft afternoon light',
    'A dense rainforest canopy viewed from below with shafts of light piercing the leaves',
    'A cozy bookshop interior on a rainy day with warm lamplight and cats sleeping on the shelves',
    'A glowing portal in an ancient stone arch leading to another world of swirling colors',
    'A whimsical illustration of a tiny house built into the hollow of a giant oak tree',
    'A dramatic undersea scene with a shipwreck covered in coral and surrounded by tropical fish',
    'A solitary lighthouse on a rocky coast illuminated by lightning in a violent storm',
    'A black and white photograph of a jazz musician playing a saxophone in a smoky club',
    'A concept art illustration of a generation ship crossing a nebula filled with stars and gas clouds',
  ]

  for (const prompt of prompts) {
    it(`passes: "${prompt.slice(0, 60)}..."`, () => {
      expect(runSecretGates(prompt)).toEqual({ ok: true })
    })
  }
})

// ─── Gibberish corpus: all must fail at least one gate ───────────────────────

describe('gibberish prompts — all must fail at least one gate', () => {
  const cases: [string, string][] = [
    ['too few words', 'paint a sky'],
    ['way too few words', 'hello'],
    ['too many words (501)', Array(501).fill('the').join(' ')],
    ['mostly symbols with 5 words', 'hello world good fine great !!!!!!!!!!!!!!!!!!!!!!'],
    ['pure symbols no words', '!!! ### $$$ %%% ^^^'],
    ['word exceeding 30-char limit', 'beautiful scene with supercalifragilisticexpialidocio painting art'],
    ['all nonsense tokens', 'zrgph blorf xyxzq wumbo flarg qzxpvb mfgrt blorch frumple zorfak'],
    ['mostly nonsense tokens', 'the beautiful zrgph blorf xyxzq wumbo flarg is very nice here'],
    ['consonant-cluster gibberish', 'xkqz wzpr thrm pqrst mnbvc lkjhg fdsapo the painting beautiful'],
    ['nonsense with enough count', 'frplx blorch xyznq wumbo flarg norf blorb frumple grzph slorg the'],
  ]

  for (const [label, prompt] of cases) {
    it(`fails: ${label}`, () => {
      const result = runSecretGates(prompt)
      expect(result.ok).toBe(false)
    })
  }
})
