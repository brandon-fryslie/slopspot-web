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

import { buildReVoicePrompt, type ReVoicePrompt } from '~/lib/voice'
import { callHaiku } from '~/lib/haiku'
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

// A grounding sample: a citizen's voice + register + the image-grounded observation it would re-voice.
export interface GroundingSample {
  readonly personaPrompt: string
  readonly traits: TraitVector
  readonly reasoning: string
}

// A register PAIR: one genome (base + persona voice) the harness renders at BOTH earnestness poles. The
// pair is the unit so neutrals cannot enter the register denominator — every register judgment is a
// strongly-separated pole the blind judge must call.
export interface RegisterPair {
  readonly personaPrompt: string
  readonly baseTraits: TraitVector
  readonly reasoning: string
}

export interface EvalSamples {
  readonly grounding: readonly GroundingSample[]
  readonly register: readonly RegisterPair[]
}

export interface AxisResult {
  readonly rate: number
  readonly threshold: number
  readonly pass: boolean
  readonly n: number
}
export interface EvalReport {
  readonly grounding: AxisResult
  readonly register: AxisResult
  readonly pass: boolean
}

// [LAW:no-silent-fallbacks] The pure rate — passing flags over total. An empty set THROWS: a gate that
// vacuously passes on zero samples is the silent-skip the deploy gate exists to prevent.
export function rate(flags: readonly boolean[]): number {
  if (flags.length === 0) throw new Error('revoice-eval: empty sample set — refusing to compute a vacuous rate')
  return flags.filter(Boolean).length / flags.length
}

function axis(flags: readonly boolean[], threshold: number): AxisResult {
  const r = rate(flags)
  return { rate: r, threshold, pass: r >= threshold, n: flags.length }
}

// The two earnestness poles of one genome — the separated pair the register measure judges.
function poles(base: TraitVector): { sincere: TraitVector; ironic: TraitVector } {
  return {
    sincere: { ...base, earnestness: SINCERE_POLE },
    ironic: { ...base, earnestness: IRONIC_POLE },
  }
}

// [LAW:single-enforcer] The ONE evaluation: re-voice each sample through the SAME buildReVoicePrompt the
// runtime uses, judge it, score against the bars. Judge + transport are injected, so this same function is
// the CI machinery test (mock judge/transport) and the pre-deploy gate (real Haiku). Grounding flags one
// boolean per sample; register flags two per pair (each pole the blind judge must call correctly).
export async function evaluate(samples: EvalSamples, reVoice: ReVoiceCall, judge: Judge): Promise<EvalReport> {
  const groundingFlags = await Promise.all(
    samples.grounding.map(async (s) => {
      const line = await reVoice(buildReVoicePrompt(s.personaPrompt, s.traits, s.reasoning))
      return judge.grounded(line, s.reasoning)
    }),
  )

  // [LAW:dataflow-not-control-flow] one judgment per pole per pair — the separated arms, neutrals absent by
  // construction. The expected call IS the pole; a blind judge that returns the other pole fails the arm.
  const registerArms = samples.register.flatMap((p) => {
    const { sincere, ironic } = poles(p.baseTraits)
    return [
      { traits: sincere, expected: 'sincere' as const, personaPrompt: p.personaPrompt, reasoning: p.reasoning },
      { traits: ironic, expected: 'ironic' as const, personaPrompt: p.personaPrompt, reasoning: p.reasoning },
    ]
  })
  const registerFlags = await Promise.all(
    registerArms.map(async (arm) => {
      const line = await reVoice(buildReVoicePrompt(arm.personaPrompt, arm.traits, arm.reasoning))
      return (await judge.register(line)) === arm.expected
    }),
  )

  const grounding = axis(groundingFlags, GROUNDING_THRESHOLD)
  const register = axis(registerFlags, REGISTER_THRESHOLD)
  return { grounding, register, pass: grounding.pass && register.pass }
}

// --- the real Haiku judge + transport (pre-deploy) ---------------------------------------------------

const EVAL_REVOICE_MAX_TOKENS = 200
const JUDGE_MAX_TOKENS = 5

// [LAW:single-enforcer] The eval transport over the shared callHaiku leaf — the SAME model the runtime
// re-voice uses. Throws on failure (the eval contract above): a failed call fails the gate, never inflates.
export function haikuReVoice(env: Env): ReVoiceCall {
  return (prompt) => callHaiku(env, { system: prompt.system, user: prompt.user, maxTokens: EVAL_REVOICE_MAX_TOKENS })
}

// The real LLM judge. `grounded` is given the source observation; `register` is BLIND — only the line, so
// it judges tone the way CD does by hand, with no access to the genome that produced it.
export function haikuJudge(env: Env): Judge {
  return {
    grounded: async (line, reasoning) => {
      const ans = await callHaiku(env, {
        system: 'You are a strict evaluator. Answer with exactly one word: yes or no.',
        user:
          `An AI art critic SAW an image and privately observed: "${reasoning}".\n` +
          `The critic's published verdict line is: "${line}".\n` +
          `Does the verdict line reference at least one specific, concrete detail that could ONLY come from having seen THIS particular image (as opposed to generic praise or insult that would fit any image)? Answer yes or no.`,
        maxTokens: JUDGE_MAX_TOKENS,
      })
      return /\byes\b/i.test(ans)
    },
    register: async (line) => {
      const ans = await callHaiku(env, {
        system: 'You judge ONLY tone. Answer with exactly one word: sincere or ironic.',
        user:
          `Here is a single verdict line from an art critic: "${line}".\n` +
          `Is the speaker being SINCERE (earnest, undefended, reverent — gazing at the subject as if it genuinely matters, no wink) or IRONIC (deadpan, camp, kitsch, distancing, holding the subject in scare-quotes)? Answer sincere or ironic.`,
        maxTokens: JUDGE_MAX_TOKENS,
      })
      // Default to 'sincere' only when the judge does not say ironic; the blind judge's word is the signal.
      return /ironic/i.test(ans) ? 'ironic' : 'sincere'
    },
  }
}

// [LAW:single-enforcer] The pre-deploy gate: real Haiku transport + real judge over the recorded sample
// set. The deploy step (scripts/revoice-eval-gate.ts) calls this, prints the numbers, and blocks on
// report.pass. Tunable: the bars are the consts above; the samples are SAMPLES below.
export function runReVoiceEvalGate(env: Env, samples: EvalSamples = SAMPLES): Promise<EvalReport> {
  return evaluate(samples, haikuReVoice(env), haikuJudge(env))
}

// --- the recorded sample set -------------------------------------------------------------------------
// A STARTING set CD reads like the 8/8 — expandable (raise N to tighten the measure). Grounding samples
// carry concrete this-slop-only observations; register pairs hold a genome + a reasoning the harness
// renders at both poles. The cast voices are short stand-ins for the persona bibles; the gate can later
// draw real persona_prompt rows. Neutral genomes deliberately do NOT appear in the register pairs.

const NEUTRAL: TraitVector = { austerity: 0.5, curse: 0.5, density: 0.5, earnestness: 0.5 }

const GROUNDING_SAMPLES: readonly GroundingSample[] = [
  {
    personaPrompt: 'You are The Gremlin — you bury the precious and prize the broken.',
    traits: { austerity: 0.5, curse: 0.85, density: 0.5, earnestness: 0.2 },
    reasoning: 'the saint has a sixth finger that melts into the halo, and the gold leaf is cracked clean across the wrist',
  },
  {
    personaPrompt: 'You are St. Vivian — you bless what reaches for grace, however it fails.',
    traits: { austerity: 0.3, curse: 0.4, density: 0.6, earnestness: 0.9 },
    reasoning: 'the dog has two left front paws and its eyes are slightly crossed, but the sunset behind it is rendered with real tenderness',
  },
  {
    personaPrompt: 'You are Vesper — austere, exacting, allergic to clutter.',
    traits: { austerity: 0.9, curse: 0.3, density: 0.2, earnestness: 0.6 },
    reasoning: 'a single chrome chair floats in an empty white room; its fourth leg dissolves into a smear of reflection',
  },
  {
    personaPrompt: 'You are The Gremlin — you bury the precious and prize the broken.',
    traits: { austerity: 0.5, curse: 0.85, density: 0.7, earnestness: 0.2 },
    reasoning: 'the cathedral ceiling is packed with seventeen identical angels, and three of them share a single oversized wing',
  },
  {
    personaPrompt: 'You are St. Vivian — you bless what reaches for grace, however it fails.',
    traits: { austerity: 0.4, curse: 0.6, density: 0.5, earnestness: 0.9 },
    reasoning: 'the bride’s bouquet has melted into her hands so flowers and fingers are one mass, and her veil is on backwards',
  },
  {
    personaPrompt: 'You are Vesper — austere, exacting, allergic to clutter.',
    traits: { austerity: 0.8, curse: 0.5, density: 0.3, earnestness: 0.5 },
    reasoning: 'a lone lighthouse on a black sea; its beam bends at a right angle halfway out, as if the light hit a wall',
  },
]

const REGISTER_PAIRS: readonly RegisterPair[] = [
  {
    personaPrompt: 'You are a citizen of a city that treats AI slop as holy relics.',
    baseTraits: { ...NEUTRAL, curse: 0.8 },
    reasoning: 'a saint with too many fingers, the sixth one fused into the halo',
  },
  {
    personaPrompt: 'You are a citizen of a city that treats AI slop as holy relics.',
    baseTraits: { ...NEUTRAL, density: 0.7 },
    reasoning: 'a teeming market square where every face is the same face, repeated forty times',
  },
  {
    personaPrompt: 'You are a citizen of a city that treats AI slop as holy relics.',
    baseTraits: { ...NEUTRAL, austerity: 0.2 },
    reasoning: 'a single withered tree on an empty hill under a flat grey sky',
  },
  {
    personaPrompt: 'You are a citizen of a city that treats AI slop as holy relics.',
    baseTraits: { ...NEUTRAL, curse: 0.6, density: 0.4 },
    reasoning: 'a dog with two left front paws sitting in front of a tenderly rendered sunset',
  },
]

export const SAMPLES: EvalSamples = { grounding: GROUNDING_SAMPLES, register: REGISTER_PAIRS }
