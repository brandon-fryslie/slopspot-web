// [LAW:single-enforcer][LAW:one-source-of-truth] The city's ONE recency decay — the function that
// turns the AGE of a past act into how much it still counts NOW. Exponential half-life: a thing
// halves in weight every `halfLifeMs`. There is exactly one decay SHAPE in the city; each consumer
// supplies its OWN rate (half-life), never its own curve. genome-9zt.7 consumes it so a niche's
// CURRENT taste outweighs a line's historical accumulation (living relevance, not unearned
// standing); genome .3 (Character With a Past) will import the SAME function for voice-tinting at
// its own rate. One mechanism, per-consumer rate — no parallel decay to reconcile later.
//
// [LAW:one-way-deps] Pure leaf: no env, no clock, no I/O. `ageMs` is supplied by the caller (now −
// the act's timestamp), so determinism stays the caller's to control.

// [LAW:types-are-the-program] A weight in (0, 1]: 1 at age 0 (a just-cast act counts in full), 0.5
// at one half-life, 0.25 at two, asymptotically toward 0 — never negative, never amplifying. A
// future-dated act (negative age, clock skew) clamps to full weight, never above it. `halfLifeMs`
// must be positive — a non-positive rate is a caller configuration bug, not a representable input.
export function recencyWeight(ageMs: number, halfLifeMs: number): number {
  return Math.pow(0.5, Math.max(0, ageMs) / halfLifeMs)
}
