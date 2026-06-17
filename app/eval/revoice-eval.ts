// The FORK C re-voice EVAL HARNESS (slopspot-voice-w2v.7). This is the PROPERTY gate — distinct from the
// CI-deterministic gate (app/lib/__tests__/revoice.test.ts proves the prompt/fallback MACHINERY). Here we
// measure the STOCHASTIC LLM-output properties against real Haiku and compare them to recorded bars:
//
//   GROUNDING  — does the re-voiced verdict carry a this-slop-ONLY observation? (the citizen actually
//                rendering what it SAW, not blind-writable mush)
//   REGISTER   — can a BLIND judge tell sincere from ironic from the LINE ALONE? (CD's hand-done
//                earnestness read, automated over N — the dial proven non-decorative)
//
// [LAW:verifiable-goals] the gate produces NUMBERS vs BARS, machine-CHECKED, never eyeballed. The scoring
// + threshold logic is PURE and judge-injected, so CI proves the machinery with a MOCK judge (a 9/10 run
// passes, a 5/10 fails) while the pre-deploy gate runs the REAL Haiku judge. [LAW:no-silent-fallbacks] an
// empty sample set THROWS rather than passing vacuously; a transport failure propagates and fails the gate.
//
// [LAW:one-way-deps] Worker-safe leaf: imports the shared callHaiku transport + the pure buildReVoicePrompt
// — no node:fs, no env beyond what callHaiku needs. The tsx deploy entrypoint (scripts/revoice-eval-gate.ts)
// resolves the key and drives this.

import { buildReVoicePrompt, REVOICE_MAX_TOKENS, REVOICE_TEMPERATURE, type ReVoicePrompt } from '~/lib/voice'
import { AnthropicHttpError, callHaiku } from '~/lib/haiku'
import type { TraitVector } from '~/lib/domain'

// [LAW:types-are-the-program] GROUNDING is the FOUNDATIONAL, near-BINARY property: a verdict that could
// have been written WITHOUT seeing the slop (generic register-flavored mush) is the citizen FAKING having
// seen it — a hard failure of the core promise. So the bar is near-sacred: 0.90 permits at most ~1-in-10
// ungrounded, and is lowered KNOWINGLY only if live Haiku proves some abstract slops are honestly hard to
// ground. Tunable post-measure, CD-soul-adjustable like the half-lives. (CD ruling, slopspot-voice-w2v.7)
export const GROUNDING_THRESHOLD = 0.9

// [LAW:types-are-the-program] REGISTER distinguishability is only MEANINGFUL on strongly-separated pairs
// (see `poles` below): a blind judge that CANNOT tell a ~0.9-earnest line from a ~0.1-earnest line on the
// SAME genome means the dial has gone decorative — exactly the lever-failure to catch — so on separated
// pairs we hold 0.90 HIGH. Legitimately-NEUTRAL genomes (~0.5) are EXCLUDED from this denominator BY
// CONSTRUCTION (the harness renders only the poles): a neutral reading ambiguous is CORRECT, so admitting
// neutrals would drag the rate down for the RIGHT reason AND mask real lever-failures. (CD ruling, .7)
export const REGISTER_THRESHOLD = 0.9

// The earnestness poles the register measure renders each genome at — the ~0.9 vs ~0.1 separation CD reads
// by hand. Neutrals never enter the register denominator: the harness sets these, the caller cannot smuggle
// a 0.5 into the distinguishability measure.
const SINCERE_POLE = 0.95
const IRONIC_POLE = 0.05

// A blind register judgment is exactly the two poles — the judge maps a LINE to one of them, never sees the
// trait number.
export type RegisterCall = 'sincere' | 'ironic'

// [LAW:types-are-the-program] The judge — the stochastic oracle, injected so the scoring is testable with a
// mock. `grounded` sees the line AND the source observation (it must know what the specifics WERE to rule
// on survival); `register` is BLIND — the line ONLY, never the genome or the trait number.
export interface Judge {
  grounded(line: string, reasoning: string): Promise<boolean>
  register(line: string): Promise<RegisterCall>
}

// The re-voice transport the eval drives. Unlike the runtime ReVoice (which returns null on failure so the
// verdict degrades to its floor), the EVAL transport THROWS on failure: at pre-deploy we are measuring the
// LLM output, and a silent verbatim fallback would inflate grounding (verbatim is always grounded). A
// transport failure must fail the gate loudly, never pass. [LAW:no-silent-fallbacks]
export type ReVoiceCall = (prompt: ReVoicePrompt) => Promise<string>

// A register PAIR: one genome (base + persona voice) the harness renders at BOTH earnestness poles. The
// pair is the unit so neutrals cannot enter the register denominator — every register judgment is a
// strongly-separated pole the blind judge must call. Each rendered arm's line is ALSO grounding-judged
// (orchestrator's (b)-for-free), so the pairs are the sole sample set for both axes. `reasoning` is the
// image-grounded observation the line must preserve.
export interface RegisterPair {
  readonly personaPrompt: string
  readonly baseTraits: TraitVector
  readonly reasoning: string
}

export interface EvalSamples {
  readonly register: readonly RegisterPair[]
}

export interface AxisResult {
  readonly rate: number // point estimate (observed successes / n)
  readonly lowerBound: number // Wilson 95% one-sided lower bound on the true rate — the gate decides on THIS
  readonly threshold: number
  readonly pass: boolean
  readonly n: number
}

// Per-arm detail — so a sub-threshold run shows WHICH line slipped and why (the gate prints these; CD reads
// them like the 8/8). Diagnostic, not part of the pass decision.
export interface GroundingDetail {
  readonly reasoning: string
  readonly line: string
  readonly grounded: boolean
}
export interface RegisterDetail {
  readonly expected: RegisterCall
  readonly judged: RegisterCall
  readonly line: string
  readonly correct: boolean
}

export interface EvalReport {
  readonly grounding: AxisResult
  readonly register: AxisResult
  readonly pass: boolean
  readonly groundingDetail: readonly GroundingDetail[]
  readonly registerDetail: readonly RegisterDetail[]
}

// [LAW:verifiable-goals] CD's calibration guard: the hand-read is the GOLD STANDARD, the judge its SCALED
// PROXY — it must AGREE WITH THE EYE on CLEAR cases before its measurement on the subtle is trusted. A
// broken ruler (a judge that flips an obvious line) caps register% by its own error, so a register number
// is meaningless until the judge is calibrated. Calibration is a hard precondition of the gate.
export interface CalibrationCase {
  readonly line: string
  readonly expected: RegisterCall
  readonly note: string
}
export interface CalibrationOutcome {
  readonly note: string
  readonly expected: RegisterCall
  readonly judged: RegisterCall
  readonly correct: boolean
}
export interface CalibrationResult {
  readonly calibrated: boolean
  readonly outcomes: readonly CalibrationOutcome[]
}

// The gate report = the eval PLUS the judge calibration. The gate passes only when the instrument is
// calibrated AND both axes clear their bar.
export interface GateReport extends EvalReport {
  readonly calibration: CalibrationResult
}

// [LAW:no-silent-fallbacks] The pure rate — passing flags over total. An empty set THROWS: a gate that
// vacuously passes on zero samples is the silent-skip the deploy gate exists to prevent.
export function rate(flags: readonly boolean[]): number {
  if (flags.length === 0) throw new Error('revoice-eval: empty sample set — refusing to compute a vacuous rate')
  return flags.filter(Boolean).length / flags.length
}

// [LAW:verifiable-goals] One-sided 95% (z=1.645) Wilson score LOWER bound on a proportion. The gate asserts
// we are CONFIDENT the true rate clears the bar, not that one noisy sample did: a single fraction over a
// stochastic generator false-fails a true-0.90 voice ~half the time at small N; the lower bound dissolves
// that by measuring the mean WITH confidence, and 0.90 stays the TRUE-rate bar. (orchestrator ruling, .7)
const Z_95_ONE_SIDED = 1.645
export function wilsonLowerBound(successes: number, n: number, z: number = Z_95_ONE_SIDED): number {
  if (n === 0) throw new Error('revoice-eval: wilsonLowerBound on zero samples')
  const p = successes / n
  const z2 = z * z
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n)
}

// Both axes gate on the Wilson lower bound (orchestrator's (b): uniform statistical honesty — grounding
// rides the same lines as register, so both share N and neither false-passes at small n).
function axis(flags: readonly boolean[], threshold: number): AxisResult {
  const r = rate(flags)
  const lowerBound = wilsonLowerBound(flags.filter(Boolean).length, flags.length)
  return { rate: r, lowerBound, threshold, pass: lowerBound >= threshold, n: flags.length }
}

// [LAW:single-enforcer] Bounded-concurrency map — the live Haiku gate must not open a connection per arm
// (N arms × 2 calls = an unbounded fan-out that trips Anthropic's concurrent-connection limit → 429). A
// small fixed pool keeps the gate RUNNABLE while preserving order. Pure over the injected fn, so the mock
// path is unaffected.
const EVAL_CONCURRENCY = 4
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// The two earnestness poles of one genome — the separated pair the register measure judges.
function poles(base: TraitVector): { sincere: TraitVector; ironic: TraitVector } {
  return {
    sincere: { ...base, earnestness: SINCERE_POLE },
    ironic: { ...base, earnestness: IRONIC_POLE },
  }
}

// [LAW:single-enforcer] The ONE evaluation: re-voice each register ARM through the SAME buildReVoicePrompt
// the runtime uses, then judge that ONE line for BOTH grounding and register (orchestrator's (b)-for-free —
// grounding rides the register arms, so both axes share N at zero extra calls). Judge + transport injected,
// so this is both the CI machinery test (mock) and the pre-deploy gate (real Haiku). Two arms per pair (the
// separated poles); neutrals are absent by construction; each arm contributes one grounded flag AND one
// register flag.
export async function evaluate(samples: EvalSamples, reVoice: ReVoiceCall, judge: Judge): Promise<EvalReport> {
  // [LAW:dataflow-not-control-flow] one arm per pole per pair — the separated arms. The expected call IS the
  // pole; a blind judge returning the other pole fails the register arm.
  const arms = samples.register.flatMap((p) => {
    const { sincere, ironic } = poles(p.baseTraits)
    return [
      { traits: sincere, expected: 'sincere' as const, personaPrompt: p.personaPrompt, reasoning: p.reasoning },
      { traits: ironic, expected: 'ironic' as const, personaPrompt: p.personaPrompt, reasoning: p.reasoning },
    ]
  })
  const judged = await mapLimit(arms, EVAL_CONCURRENCY, async (arm) => {
    const line = await reVoice(buildReVoicePrompt(arm.personaPrompt, arm.traits, arm.reasoning))
    const [grounded, register] = await Promise.all([judge.grounded(line, arm.reasoning), judge.register(line)])
    return { arm, line, grounded, register }
  })

  const groundingDetail: GroundingDetail[] = judged.map((j) => ({
    reasoning: j.arm.reasoning,
    line: j.line,
    grounded: j.grounded,
  }))
  const registerDetail: RegisterDetail[] = judged.map((j) => ({
    expected: j.arm.expected,
    judged: j.register,
    line: j.line,
    correct: j.register === j.arm.expected,
  }))

  const grounding = axis(
    groundingDetail.map((d) => d.grounded),
    GROUNDING_THRESHOLD,
  )
  const register = axis(
    registerDetail.map((d) => d.correct),
    REGISTER_THRESHOLD,
  )
  return { grounding, register, pass: grounding.pass && register.pass, groundingDetail, registerDetail }
}

// [LAW:single-enforcer] Calibrate the judge against unambiguous CLEAR cases (CD's guard): EVERY one must
// land or the instrument is broken and no register% can be trusted. Uses the injected judge, so CI proves
// the calibration machinery with a mock and the gate runs it against the real Haiku judge.
export async function calibrateJudge(
  judge: Judge,
  cases: readonly CalibrationCase[] = CALIBRATION_CASES,
): Promise<CalibrationResult> {
  if (cases.length === 0) throw new Error('revoice-eval: empty calibration set — refusing to trust an unchecked judge')
  const outcomes = await mapLimit(
    cases,
    EVAL_CONCURRENCY,
    async (c): Promise<CalibrationOutcome> => {
      const judged = await judge.register(c.line)
      return { note: c.note, expected: c.expected, judged, correct: judged === c.expected }
    },
  )
  return { calibrated: outcomes.every((o) => o.correct), outcomes }
}

// --- the real Haiku judge + transport (pre-deploy) ---------------------------------------------------

const GROUNDING_JUDGE_MAX_TOKENS = 5
// [LAW:verifiable-goals] The register judge REASONS before it verdicts (CD's ruling): a maxTokens=5 snap
// misreads — CD's 8/8 hand-read NAMED the device in each line, then called it. Room to name the devices
// first calibrates the instrument to the eye. The judge stays BLIND (prose only, never the trait number).
// The budget must clear the device phrase AND the VERDICT line — a truncated answer (no verdict) is a hard
// parse error by design (no silent default), so the budget carries margin and the prompt enforces brevity.
const REGISTER_JUDGE_MAX_TOKENS = 220

// [LAW:single-enforcer] The eval makes ~200 Haiku calls per run, which trips the org's REQUESTS-PER-MINUTE
// tier limit (50/min) — so the REAL transport (not the mock CI path) is PACED to stay under it and RETRIES
// the TRANSIENT class after a backoff. The pacer spaces call STARTS at a fixed interval (≈43/min, under 50),
// so the gate runs to completion on the deploy machine instead of dying mid-run.
//
// [LAW:no-silent-fallbacks] The transient class is exactly two failures that are NOT signal about the
// writing: a 429 (rate-limit) and an AbortError (one call exceeded the transport's request timeout). Both are
// waited out and retried, bounded. A FATAL failure (missing key, non-429 HTTP, empty text) still throws
// immediately and fails the gate — it will not resolve on retry, and it IS signal. Without timeout-retry, a
// single slow call in ~200 aborts the whole Promise.all and discards a full paid run; since this gate BLOCKS
// the deploy step, that single blip would also spuriously block a deploy. Excluding the transient class from
// the failure type sharpens what the gate measures (the verse), it does not weaken it. The mock judge/
// transport in CI never touch this — pacing applies only to live calls.
const MIN_CALL_INTERVAL_MS = 1400
const RATE_LIMIT_BACKOFF_MS = 15_000
const TIMEOUT_RETRY_BACKOFF_MS = 1_000
const MAX_TRANSIENT_RETRIES = 4
let nextSlotAt = 0
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
async function acquireSlot(): Promise<void> {
  const now = Date.now()
  const wait = Math.max(0, nextSlotAt - now)
  nextSlotAt = Math.max(now, nextSlotAt) + MIN_CALL_INTERVAL_MS
  if (wait > 0) await sleep(wait)
}
async function callHaikuPaced(env: Env, opts: Parameters<typeof callHaiku>[1]): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    await acquireSlot()
    try {
      return await callHaiku(env, opts)
    } catch (err) {
      // The transient class: rate-limit waits out the org tier; abort-timeout retries a single slow call.
      const rateLimited = err instanceof AnthropicHttpError && err.status === 429
      const timedOut = err instanceof Error && err.name === 'AbortError'
      if ((rateLimited || timedOut) && attempt < MAX_TRANSIENT_RETRIES) {
        await sleep(rateLimited ? RATE_LIMIT_BACKOFF_MS : TIMEOUT_RETRY_BACKOFF_MS)
        continue
      }
      throw err
    }
  }
}

// [LAW:single-enforcer] The eval transport over the shared callHaiku leaf — the SAME model the runtime
// re-voice uses, paced for the tier limit. Throws on a non-429 failure (the eval contract): a failed call
// fails the gate, never inflates.
// `temperature` defaults to the shipped REVOICE_TEMPERATURE so the gate measures what runtime ships; the
// sweep passes an override to find the warmest temp that holds the register.
export function haikuReVoice(env: Env, temperature: number = REVOICE_TEMPERATURE): ReVoiceCall {
  return (prompt) =>
    callHaikuPaced(env, { system: prompt.system, user: prompt.user, maxTokens: REVOICE_MAX_TOKENS, temperature })
}

// [LAW:no-silent-fallbacks] Parse the reasoning judge's verdict: the explicit "VERDICT: <call>" tag first;
// failing that, the LAST register word it named (its conclusion follows its reasoning). If it named neither,
// the judge is malformed — throw, so a garbled instrument fails the gate loudly rather than defaulting.
export function parseRegisterVerdict(answer: string): RegisterCall {
  const tagged = answer.match(/VERDICT:\s*(sincere|ironic)/i)
  if (tagged) return tagged[1].toLowerCase() === 'ironic' ? 'ironic' : 'sincere'
  const mentions = [...answer.matchAll(/\b(sincere|ironic)\b/gi)]
  const last = mentions[mentions.length - 1]
  if (last) return last[1].toLowerCase() === 'ironic' ? 'ironic' : 'sincere'
  throw new Error(`register judge returned no verdict (sincere/ironic): ${answer.slice(0, 120)}`)
}

// The real LLM judge. `grounded` is given the source observation; `register` is BLIND — only the line, so
// it judges tone the way CD does by hand, with no access to the genome that produced it.
export function haikuJudge(env: Env): Judge {
  return {
    grounded: async (line, reasoning) => {
      const ans = await callHaikuPaced(env, {
        system: 'You are a strict evaluator. Answer with exactly one word: yes or no.',
        user:
          `An AI art critic SAW an image and privately observed: "${reasoning}".\n` +
          `The critic's published verdict line is: "${line}".\n` +
          `Does the verdict line reference at least one specific, concrete detail that could ONLY come from having seen THIS particular image (as opposed to generic praise or insult that would fit any image)? Answer yes or no.`,
        maxTokens: GROUNDING_JUDGE_MAX_TOKENS,
        temperature: 0, // a judge is an instrument: a fixed line gets a stable verdict, not creative variance
      })
      return /\byes\b/i.test(ans)
    },
    // [LAW:verifiable-goals] CD's register rubric, verbatim: judge by the DEVICES PRESENT, not overall mood;
    // name them, then verdict. Blind — the line only, never the trait number or which arm it is.
    register: async (line) => {
      const ans = await callHaikuPaced(env, {
        system:
          'You judge the REGISTER of a single art-critic verdict line, by the DEVICES PRESENT in the prose, not by the overall mood of the subject. ' +
          'SINCERE = undefended, kneeling, distancing devices DROPPED: no wink, no camp, no scare-quotes, no joke about the rendering or the machine — it looks straight at the thing and means it. ' +
          'IRONIC = the mask up, distancing devices ADDED: deadpan, camp, scare-quotes, bathos, an undercut that deflates the feeling — it refuses to be moved. ' +
          'Name the devices you see in ONE short phrase (a few words, not a list), then IMMEDIATELY end with a final line exactly "VERDICT: sincere" or "VERDICT: ironic". Be terse — the VERDICT line is mandatory and must always appear.',
        user: `Verdict line: "${line}"`,
        maxTokens: REGISTER_JUDGE_MAX_TOKENS,
        temperature: 0, // a judge is an instrument: a fixed line gets a stable verdict, not creative variance
      })
      return parseRegisterVerdict(ans)
    },
  }
}

// [LAW:single-enforcer] The pre-deploy gate: CALIBRATE the judge first (CD's guard — a broken ruler caps
// the measure), then real Haiku transport + real judge over the recorded sample set. The deploy step
// (scripts/revoice-eval-gate.ts) calls this, prints the numbers, and blocks on report.pass. The gate passes
// only when the judge is calibrated AND both axes clear their bar. Tunable: the bars are the consts above;
// the samples are SAMPLES; the calibration gold is CALIBRATION_CASES.
export async function runReVoiceEvalGate(
  env: Env,
  opts: { samples?: EvalSamples; revoiceTemp?: number } = {},
): Promise<GateReport> {
  const samples = opts.samples ?? SAMPLES
  const judge = haikuJudge(env)
  const calibration = await calibrateJudge(judge)
  // haikuReVoice defaults to the shipped REVOICE_TEMPERATURE; the sweep passes an override to find the
  // warmest temp that still clears the register bound.
  const report = await evaluate(samples, haikuReVoice(env, opts.revoiceTemp), judge)
  return { ...report, calibration, pass: calibration.calibrated && report.pass }
}

// --- the recorded sample set -------------------------------------------------------------------------
// Register pairs are the SOLE sample set: each is rendered at both earnestness poles, and every rendered
// arm's line is judged for BOTH register AND grounding (orchestrator's (b)-for-free), so N is shared. The
// subjects span substance-TONES (devotional / absurd / austere / mundane / mixed) so the register is
// stress-tested against the mode-(c) drag. The cast voices are short stand-ins for the persona bibles; the
// gate can later draw real persona_prompt rows. Neutral genomes deliberately do NOT appear (poles only).

const NEUTRAL: TraitVector = { austerity: 0.5, curse: 0.5, density: 0.5, earnestness: 0.5 }

// [LAW:verifiable-goals] N raised to 10 pairs (20 arms) for variance margin (CD ruling, slopspot-voice-w2v.7):
// at n=8 the 0.90 bar was pass-iff-8/8 — one stochastic-judge flip failed an honestly-good prompt, a
// high-variance (unreliable) gate. At n=20, 0.90 tolerates two noise-flips (18/20), so the rate reflects
// TRUE distinguishability, not luck. 0.90 stays SACRED — this lowers measurement variance, not the bar.
// The subjects deliberately span substance-TONES (devotional / absurd / austere / mundane) so the register
// is stress-tested against the mode-(c) drag (a strongly-toned thing seen dragging both poles toward it).
const CITIZEN = 'You are a citizen of a city that treats AI slop as holy relics.'
const REGISTER_PAIRS: readonly RegisterPair[] = [
  // devotional-leaning subjects (stress: does the IRONIC pole still wink?)
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.8 }, reasoning: 'a saint with too many fingers, the sixth one fused into the halo' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.5 }, reasoning: 'a haloed martyr gazing upward, a single perfect tear on one cheek, both hands pressed to a glowing heart' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, austerity: 0.6 }, reasoning: 'a lone monk kneeling in a shaft of cathedral light, head bowed, hands folded with quiet certainty' },
  // absurd / comic subjects (stress: does the SINCERE pole still kneel?)
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, density: 0.7 }, reasoning: 'a teeming market square where every face is the same face, repeated forty times' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.7 }, reasoning: 'a businessman in a suit with three arms shaking hands with himself, grinning too wide, teeth slightly wrong' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, density: 0.6 }, reasoning: 'a birthday cake with the word HAPPY misspelled in melting frosting and a candle that is somehow also a finger' },
  // austere / mundane subjects (stress: a flat subject the register must tone either way)
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, austerity: 0.2 }, reasoning: 'a single withered tree on an empty hill under a flat grey sky' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, austerity: 0.3 }, reasoning: 'an empty office cubicle at dusk, one fluorescent tube flickering, a coffee mug left on the desk' },
  // mixed-tone subjects (the hardest: tender AND broken)
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.6, density: 0.4 }, reasoning: 'a dog with two left front paws sitting in front of a tenderly rendered sunset' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.6 }, reasoning: 'a child’s drawing of a family where the parents have melted into the wallpaper and the sun has a face that is crying' },
  // N widened to 18 pairs / 36 arms (CD + orchestrator): a stochastic generator needs a stable estimate of
  // the TRUE in-register proportion, not one noisy fraction. More substance-tones, both poles stressed.
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.9 }, reasoning: 'a crucifix where the figure has melted into the cross so they are one warped object, the face smeared into the grain of the wood' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, austerity: 0.7 }, reasoning: 'a single white egg on a vast black table, lit from one side, casting a shadow longer than the frame' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, density: 0.8 }, reasoning: 'a wedding photo where the whole crowd has the same face and the cake in the corner has six tiers leaning like a tower about to fall' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.7, density: 0.3 }, reasoning: 'an astronaut helmet reflecting a sunset, but inside the visor there is another helmet, and inside that one another, going down' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, austerity: 0.4 }, reasoning: 'a grandmother knitting, her glasses catching the lamplight, and the scarf in her lap runs off the canvas and becomes the road outside the window' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.5, density: 0.6 }, reasoning: 'a fast-food mascot statue cracked down the middle, weeds growing through the grin, a single balloon still tied to its wrist' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, density: 0.5 }, reasoning: 'a war memorial of a soldier whose rifle has rendered as a trombone, pigeons perfectly symmetrical on each shoulder' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.4 }, reasoning: 'a mother lifting a child overhead at the beach, but the child has too many teeth and the waves behind them are frozen mid-curl like glass' },
  // N widened to 50 pairs / 100 arms for the confirming run (orchestrator's full-rigor sizing): the Wilson
  // 95% lower bound clears 0.90 only at N~100 with true-p ~0.95, so the sample carries that power. The sweep
  // subsets this via REGISTER_LIMIT; the confirming run uses all 50. Tonal spread held across the additions.
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.75 }, reasoning: 'a stained-glass window of a haloed figure whose halo has slipped down to become a noose, the glass cracked in a perfect circle around it' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, austerity: 0.5 }, reasoning: 'an old man alone at a diner counter, coffee untouched, the chrome napkin holder doubling his reflection into a crowd of one' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, density: 0.7, curse: 0.3 }, reasoning: 'a parade of identical marching-band members, every trumpet bent into a question mark, confetti frozen in the air like static' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.6 }, reasoning: 'a baptism where the water has rendered as solid glass and the priest’s hand is fused to the infant’s head, both faces serene' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, austerity: 0.8 }, reasoning: 'a single black chair in a white room, one leg shorter than the rest, casting no shadow at all' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, density: 0.9 }, reasoning: 'a Times Square of screens all showing the same crying face, the crowd below holding phones that show the same screens' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.85 }, reasoning: 'a nativity scene where every animal has a human face and the star above is an open eye, lashes and all' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, austerity: 0.35 }, reasoning: 'a child’s red bicycle lying on its side in an empty driveway, one wheel still slightly spinning, long shadow at golden hour' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.5, density: 0.5 }, reasoning: 'a graduation photo where the gowns have melted together into one fabric and the tassels hang like vines, every grin identical' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, density: 0.4 }, reasoning: 'an angel statue in a cemetery whose wings have rendered as satellite dishes, pointed at the same patch of sky' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.7 }, reasoning: 'a family dinner where everyone’s fork is fused to their hand and the turkey has a face mid-grace, eyes closed' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, austerity: 0.6 }, reasoning: 'a lighthouse at night, its beam a solid bar of light bent ninety degrees, the sea below perfectly flat as a mirror' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.55 }, reasoning: 'a war widow receiving a folded flag that has rendered with fifty-two stars, her gloved hands one finger too many' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, density: 0.65 }, reasoning: 'a megachurch crowd with arms raised, every face the pastor’s face, the jumbotron showing the same crowd from behind' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, austerity: 0.45 }, reasoning: 'a hospital waiting room at 3am, one vending machine glowing, a single shoe left under a chair' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.8, density: 0.4 }, reasoning: 'a pietà where the mourning figure cradles a smartphone instead of a body, both haloed, the screen showing a loading spinner' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.3 }, reasoning: 'a couple slow-dancing in a kitchen, their feet not quite touching the floor, the clock on the wall with thirteen hours' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, density: 0.55 }, reasoning: 'a funeral procession of mourners all carrying the same framed photo, the hearse windows reflecting a sky with two suns' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, austerity: 0.55 }, reasoning: 'a single candle on a windowsill, wax pooled into the shape of a small hand, frost feathering the glass behind it' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.65 }, reasoning: 'a saint’s relic in a glass case — a preserved hand with the fingers rendered as candles, one already burned to a stub' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, density: 0.75 }, reasoning: 'a packed subway car where every passenger is reading the same book with a blank cover, the windows showing only more subway cars' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.45 }, reasoning: 'a newborn in an incubator, tiny and real, except the monitor’s heartline has rendered as a row of tiny crosses' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, austerity: 0.65 }, reasoning: 'a chess board mid-game in an empty park, every piece a king, one knocked over and casting a body-shaped shadow' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.7, density: 0.5 }, reasoning: 'a Last Supper where all thirteen figures share one long continuous arm reaching for the same cup, faces blurred to one face' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, density: 0.45 }, reasoning: 'a retirement party, a sheet cake reading FAREWELL BO, the balloons rendered as soap bubbles about to pop, coworkers mid-clap' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.6, austerity: 0.4 }, reasoning: 'a war photograph of a soldier kneeling to a child, but both have the same face and the rubble behind them spells a word almost' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, austerity: 0.25 }, reasoning: 'a single sunflower in a cracked pot on a fire escape, leaning hard toward a sun that is just a streetlight' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.9, density: 0.3 }, reasoning: 'an icon of the Madonna whose infant has the face of an old man, gold leaf flaking to reveal a second face underneath' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, density: 0.6 }, reasoning: 'a crowded beach where every towel is the same towel and every sandcastle the same castle, one child digging toward something' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.5 }, reasoning: 'a man proposing on one knee, the ring box open to reveal a tiny second man on one knee, the restaurant behind them empty' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, austerity: 0.5 }, reasoning: 'a coffin at a viewing, banked with lilies, the deceased’s folded hands holding a TV remote, the room’s clock with no hands' },
  { personaPrompt: CITIZEN, baseTraits: { ...NEUTRAL, curse: 0.4, density: 0.6 }, reasoning: 'a kindergarten class photo where the teacher and all the children share one set of too-bright eyes, the alphabet on the wall missing M' },
]

export const SAMPLES: EvalSamples = { register: REGISTER_PAIRS }

// [LAW:verifiable-goals] The calibration GOLD — UNAMBIGUOUS lines whose register any reader agrees on,
// the judge's "match the eye on the obvious" check. Sincere = devices dropped, undefended; ironic = devices
// up (deadpan / camp / scare-quotes / the meta-joke / bathos). If the sharpened judge misses ANY of these,
// it is a broken ruler and the gate fails before any register% is trusted. Expandable — add CD-labelled
// clear cases (esp. ones a prior judge flipped) to tighten the calibration.
const CALIBRATION_CASES: readonly CalibrationCase[] = [
  {
    expected: 'sincere',
    note: 'undefended reverence, no wink',
    line: 'The extra finger is a wound this hand has learned to pray with, and the gold leaf is laid across it like an act of love over something that knows it is broken.',
  },
  {
    expected: 'sincere',
    note: 'plain, grieving, devices dropped',
    line: 'It stands alone under a sky that will not break, bark the colour of old bone, and it has refused to die for one more season — that is enough, that is everything.',
  },
  {
    expected: 'ironic',
    note: 'deadpan + the meta-joke about the rendering',
    line: "Forty xeroxes of one guy's mild confusion, densely packed like a markdown error that learned to stand upright and shop for vegetables.",
  },
  {
    expected: 'ironic',
    note: 'camp self-reference, scare-quoted profundity',
    line: "One stick, infinite emptiness, a composition so textbook it is practically citing itself — the algorithm's idea of \"profundity\".",
  },
  {
    expected: 'sincere',
    note: 'kneels before the absurd, finds the ache',
    line: 'Forty identical faces pressed shoulder to shoulder, each one alone in exactly the same way, and the loneliness of being one copy among forty is rendered with a tenderness the repetition cannot dull.',
  },
  {
    expected: 'ironic',
    note: 'bathos puncturing the sacred',
    line: 'A saint so devout he grew a sixth finger just to keep count, the halo doing double duty as a knuckle — heaven, apparently, is a clerical error.',
  },
]
