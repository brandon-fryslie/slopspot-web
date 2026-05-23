// [LAW:one-source-of-truth] The firehose's prompt fixture lives here exactly
// once. It is the dumb baseline; variety.5 replaces this whole module with the
// taxonomy-driven `chooseNextGeneration()` chooser. Until then, this list is the
// canonical "what does the cron post about" answer — not a default that other
// callers may override.
//
// [LAW:types-are-the-program] `pickPrompt` is pure: scheduled time in, prompt
// out. No clocks, no env, no I/O. That keeps the orchestrator's only real
// decision — "which prompt this fire?" — trivially testable, and lets the
// handler itself stay a thin compose-three-things shape.

const PROMPTS: readonly string[] = [
  'a tiny astronaut floating in a cup of black coffee, photoreal, soft morning light',
  'an art-deco subway station overgrown with bioluminescent moss, wide shot',
  'a paper-cut diorama of a city skyline at dusk, layered shadows',
  'a stained-glass window depicting a server rack, ornate gothic frame',
  'a still life of office supplies as ritual artifacts, oil painting, museum lighting',
  'a feral cat in a candy-colored neon alley, 35mm film grain',
  'a chrome-and-marble lobby of an abandoned future, golden hour',
  'a fox curled asleep in a teacup made of mist, watercolor',
  'an underwater library lit by jellyfish, long-exposure photography',
  'a samurai action figure in a desert diorama, macro photography, soft fill light',
] as const

// [LAW:types-are-the-program] FNV-1a 32-bit on the string-form of the
// timestamp. Plain `tick % len` is sensitive to the cron cadence: a 6-hour
// cadence with a 10-prompt list lands on the same bucket every fire because
// 360 minutes mod 10 == 0. A hash decouples the bucket from the modular
// alignment of the cadence, so any cadence × any list length still spreads.
// FNV-1a is small, branch-free, and deterministic — no library, no Web Crypto
// ceremony. The constants are FNV's published 32-bit offset basis and prime.
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

// [LAW:dataflow-not-control-flow] Same operation every fire: hash → mod → look
// up. No branches on "is this the first invocation," no clocks, no env. The
// bucket is a function of the input alone.
export function pickPrompt(scheduledTimeMs: number): string {
  const idx = fnv1a32(String(scheduledTimeMs)) % PROMPTS.length
  return PROMPTS[idx]!
}

// Exported for tests that want to assert distribution shape without
// re-declaring the list length. Production callers go through pickPrompt.
export const PROMPT_COUNT = PROMPTS.length
