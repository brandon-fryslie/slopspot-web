// [LAW:behavior-not-structure] FORK C's eval-gate MACHINERY, proven deterministically (slopspot-voice-w2v.7).
// This is NOT the property gate — the real Haiku judge runs pre-deploy (scripts/revoice-eval-gate.ts). Here a
// MOCK judge + MOCK transport prove the scoring / Wilson-bound / sampling LOGIC: a passing run passes, a
// failing run (grounding OR register below the bound) fails, both axes ride the SAME re-voiced arm lines so
// they share N (orchestrator's (b)-for-free), the gate decides on the Wilson LOWER BOUND (a tiny perfect
// sample still fails — confidence, not one fraction), the register denominator is the separated POLES, and
// an empty set throws rather than vacuously passing.

import { describe, expect, it } from 'vitest'
import {
  calibrateJudge,
  evaluate,
  parseRegisterVerdict,
  rate,
  wilsonLowerBound,
  GROUNDING_THRESHOLD,
  REGISTER_THRESHOLD,
  SAMPLES,
  type CalibrationCase,
  type EvalSamples,
  type Judge,
  type ReVoiceCall,
} from '~/eval/revoice-eval'
import { NEUTRAL_TRAITS } from '~/lib/traits'

// A transport that tags its line with the earnestness pole from the traitBias STEER baked into the prompt
// ("toward the face" for the sincere pole, "toward the mask" for the ironic) and echoes the observation
// (p.user === reasoning) — so a perfect judge can read both grounding (observation survived) and register
// (the pole) deterministically. Keys off the STEER, not clause prose, so it is robust to directive wording.
const taggingReVoice = (calls: string[] = []): ReVoiceCall => async (p) => {
  calls.push(p.system)
  const pole = p.system.includes('toward the face')
    ? 'sincere'
    : p.system.includes('toward the mask')
      ? 'ironic'
      : 'neutral'
  return `[${pole}] ${p.user}`
}

// A perfect judge: grounded iff the observation survived into the line; register reads the pole tag.
const perfectJudge: Judge = {
  grounded: async (line, reasoning) => line.includes(reasoning),
  register: async (line) => (line.includes('[ironic]') ? 'ironic' : 'sincere'),
}

describe('rate — the pure scorer', () => {
  it('is passing/total', () => {
    expect(rate([true, true, false, true])).toBe(0.75)
    expect(rate([true, true])).toBe(1)
  })
  it('THROWS on an empty set (a vacuous pass is the silent-skip the gate exists to prevent)', () => {
    expect(() => rate([])).toThrow(/empty sample set/)
  })
})

// [LAW:verifiable-goals] The gate decides on the Wilson 95% one-sided LOWER BOUND, not a single fraction:
// confidence in the TRUE rate, not luck on one sample.
describe('wilsonLowerBound — the confidence gate statistic', () => {
  it('is below the point estimate, and tightens toward it as N grows', () => {
    expect(wilsonLowerBound(95, 100)).toBeLessThan(0.95)
    expect(wilsonLowerBound(950, 1000)).toBeGreaterThan(wilsonLowerBound(95, 100)) // same rate, larger N → tighter
  })
  it('a TINY perfect sample does NOT clear 0.90 (100% on n=2 → bound ≈ 0.43)', () => {
    expect(wilsonLowerBound(2, 2)).toBeLessThan(GROUNDING_THRESHOLD)
  })
  it('clears 0.90 only with both high rate AND adequate N (100/100 → ≈0.96)', () => {
    expect(wilsonLowerBound(100, 100)).toBeGreaterThanOrEqual(0.9)
    expect(wilsonLowerBound(90, 100)).toBeLessThan(0.9) // observed exactly at the bar does NOT clear the bound
  })
  it('THROWS on zero samples', () => {
    expect(() => wilsonLowerBound(0, 0)).toThrow(/zero samples/)
  })
})

describe('evaluate — the gate machinery (mock judge + mock transport)', () => {
  it('PASSES a clean run: both axes 100% over N=100 → lower bound clears 0.90', async () => {
    const report = await evaluate(SAMPLES, taggingReVoice(), perfectJudge)
    expect(report.grounding.rate).toBe(1)
    expect(report.register.rate).toBe(1)
    expect(report.grounding.lowerBound).toBeGreaterThanOrEqual(GROUNDING_THRESHOLD)
    expect(report.register.lowerBound).toBeGreaterThanOrEqual(REGISTER_THRESHOLD)
    expect(report.pass).toBe(true)
  })

  it('grounding RIDES the register arms — both axes share N (orchestrator (b)-for-free)', async () => {
    const report = await evaluate(SAMPLES, taggingReVoice(), perfectJudge)
    expect(report.register.n).toBe(SAMPLES.register.length * 2) // two poles per pair
    expect(report.grounding.n).toBe(report.register.n) // same lines judged for both
  })

  it('the register denominator is the separated POLES — both rendered, never a neutral', async () => {
    const calls: string[] = []
    await evaluate(SAMPLES, taggingReVoice(calls), perfectJudge)
    expect(calls.some((s) => s.includes('toward the face'))).toBe(true)
    expect(calls.some((s) => s.includes('toward the mask'))).toBe(true)
    expect(calls.every((s) => s.includes('toward the face') || s.includes('toward the mask'))).toBe(true)
  })

  it('the gate decides on the BOUND, not the fraction: a tiny 100% sample FAILS', async () => {
    const onePair: EvalSamples = { register: [{ personaPrompt: 'p', baseTraits: NEUTRAL_TRAITS, reasoning: 'r' }] }
    const report = await evaluate(onePair, taggingReVoice(), perfectJudge)
    expect(report.register.rate).toBe(1) // perfect on the sample
    expect(report.register.pass).toBe(false) // but n=2 → lower bound ≈ 0.43, far below 0.90
  })

  it('FAILS when grounding misses the bar (blind-writable mush that drops the observation)', async () => {
    const mushReVoice: ReVoiceCall = async () => 'a generic verdict that saw nothing'
    const report = await evaluate(SAMPLES, mushReVoice, perfectJudge)
    expect(report.grounding.rate).toBe(0)
    expect(report.grounding.pass).toBe(false)
    expect(report.pass).toBe(false)
  })

  it('FAILS when the register dial is decorative (a blind judge cannot tell the poles apart)', async () => {
    const lazyJudge: Judge = { grounded: perfectJudge.grounded, register: async () => 'sincere' }
    const report = await evaluate(SAMPLES, taggingReVoice(), lazyJudge)
    expect(report.register.rate).toBe(0.5) // every ironic arm wrong
    expect(report.register.pass).toBe(false)
    expect(report.pass).toBe(false)
  })

  it('THROWS rather than vacuously passing on an empty sample set', async () => {
    const empty: EvalSamples = { register: [] }
    await expect(evaluate(empty, taggingReVoice(), perfectJudge)).rejects.toThrow(/empty sample set/)
  })
})

// [LAW:no-silent-fallbacks] The reasoning judge names devices then verdicts; the parser takes the explicit
// tag, else the last register word, else throws (a garbled instrument must not silently default).
describe('parseRegisterVerdict — the reasoning judge parser', () => {
  it('takes the explicit VERDICT tag', () => {
    expect(parseRegisterVerdict('camp + scare-quotes.\nVERDICT: ironic')).toBe('ironic')
    expect(parseRegisterVerdict('devices dropped, undefended.\nVERDICT: sincere')).toBe('sincere')
  })
  it('the tag WINS over an earlier mention in the reasoning', () => {
    expect(parseRegisterVerdict('uses an ironic frame? no — it kneels. VERDICT: sincere')).toBe('sincere')
  })
  it('falls back to the LAST register word when the tag is missing', () => {
    expect(parseRegisterVerdict('the wink and bathos make this clearly ironic')).toBe('ironic')
  })
  it('THROWS when neither word appears (a malformed judge fails the gate, never defaults)', () => {
    expect(() => parseRegisterVerdict('I am not sure what this is')).toThrow(/no verdict/)
  })
})

// [LAW:verifiable-goals] The calibration GUARD: the judge must match the eye on clear cases (ALL of them)
// before its register% is trusted; one miss = uncalibrated = a broken ruler. Proven with a mock judge.
describe('calibrateJudge — the instrument check (mock judge)', () => {
  const declaredJudge: Judge = {
    grounded: async () => true,
    register: async (line) => (line.includes('[ironic]') ? 'ironic' : 'sincere'),
  }
  const goldCases: CalibrationCase[] = [
    { expected: 'sincere', note: 's1', line: '[sincere] kneels' },
    { expected: 'ironic', note: 'i1', line: '[ironic] winks' },
  ]

  it('is CALIBRATED when the judge calls every clear case correctly', async () => {
    const result = await calibrateJudge(declaredJudge, goldCases)
    expect(result.calibrated).toBe(true)
    expect(result.outcomes).toHaveLength(2)
  })

  it('is UNCALIBRATED when the judge flips even ONE clear case (a broken ruler)', async () => {
    const flips: Judge = { grounded: async () => true, register: async () => 'sincere' }
    const result = await calibrateJudge(flips, goldCases)
    expect(result.calibrated).toBe(false)
    expect(result.outcomes.filter((o) => !o.correct)).toHaveLength(1)
  })

  it('THROWS on an empty calibration set (never trust an unchecked judge)', async () => {
    await expect(calibrateJudge(declaredJudge, [])).rejects.toThrow(/empty calibration set/)
  })
})
