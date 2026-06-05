// [LAW:behavior-not-structure] FORK C's eval-gate MACHINERY, proven deterministically (slopspot-voice-w2v.7).
// This is NOT the property gate — the real Haiku judge runs pre-deploy (scripts/revoice-eval-gate.ts). Here a
// MOCK judge + MOCK transport prove the scoring/threshold/sampling LOGIC: a passing run passes, a failing run
// (grounding OR register below the bar) fails, the rate refuses to vacuously pass on empty, and the register
// denominator is the separated POLES — two arms per pair, neutrals never entering. CD's "the grounding-gate
// code runs and rejects a non-grounded line given a mock judge."

import { describe, expect, it } from 'vitest'
import {
  evaluate,
  rate,
  GROUNDING_THRESHOLD,
  REGISTER_THRESHOLD,
  SAMPLES,
  type EvalSamples,
  type Judge,
  type ReVoiceCall,
} from '~/eval/revoice-eval'

// A transport that tags its line with the earnestness pole baked into the prompt (traitBias renders "the
// face" for the sincere pole, "the mask" for the ironic) and echoes the observation — so a perfect judge can
// read both grounding (observation survived) and register (the pole) deterministically.
const taggingReVoice = (calls: string[] = []): ReVoiceCall => async (p) => {
  calls.push(p.system)
  const pole = p.system.includes('the face') ? 'sincere' : p.system.includes('the mask') ? 'ironic' : 'neutral'
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

describe('evaluate — the gate machinery (mock judge + mock transport)', () => {
  it('PASSES a clean run: grounding 1.0, register 1.0, both ≥ bar', async () => {
    const report = await evaluate(SAMPLES, taggingReVoice(), perfectJudge)
    expect(report.grounding.rate).toBe(1)
    expect(report.register.rate).toBe(1)
    expect(report.pass).toBe(true)
    // the recorded bars travel into the report (CD reads numbers vs bars)
    expect(report.grounding.threshold).toBe(GROUNDING_THRESHOLD)
    expect(report.register.threshold).toBe(REGISTER_THRESHOLD)
  })

  it('the register denominator is the separated POLES — two arms per pair, never a neutral', async () => {
    const calls: string[] = []
    const report = await evaluate(SAMPLES, taggingReVoice(calls), perfectJudge)
    expect(report.grounding.n).toBe(SAMPLES.grounding.length)
    expect(report.register.n).toBe(SAMPLES.register.length * 2)
    // every register arm rendered a real pole; no judgment ran at a neutral earnestness (the masking case
    // CD ruled out). The register systems include both poles and never a neutral-earnestness steer.
    const registerSystems = calls.slice(SAMPLES.grounding.length)
    expect(registerSystems.some((s) => s.includes('the face'))).toBe(true)
    expect(registerSystems.some((s) => s.includes('the mask'))).toBe(true)
    expect(registerSystems.every((s) => s.includes('the face') || s.includes('the mask'))).toBe(true)
  })

  it('FAILS when grounding misses the bar (blind-writable mush that drops the observation)', async () => {
    const mushReVoice: ReVoiceCall = async () => 'a generic verdict that saw nothing'
    const report = await evaluate(SAMPLES, mushReVoice, perfectJudge)
    expect(report.grounding.rate).toBe(0)
    expect(report.grounding.pass).toBe(false)
    expect(report.pass).toBe(false)
  })

  it('FAILS when the register dial is decorative (a blind judge cannot tell the poles apart)', async () => {
    // The judge calls everything 'sincere' → every ironic arm is wrong → 0.5, below the bar.
    const lazyJudge: Judge = { grounded: perfectJudge.grounded, register: async () => 'sincere' }
    const report = await evaluate(SAMPLES, taggingReVoice(), lazyJudge)
    expect(report.register.rate).toBe(0.5)
    expect(report.register.pass).toBe(false)
    expect(report.pass).toBe(false)
  })

  it('THROWS rather than vacuously passing on an empty sample set', async () => {
    const empty: EvalSamples = { grounding: [], register: [] }
    await expect(evaluate(empty, taggingReVoice(), perfectJudge)).rejects.toThrow(/empty sample set/)
  })
})
