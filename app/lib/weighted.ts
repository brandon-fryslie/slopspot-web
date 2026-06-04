// [LAW:single-enforcer] The city's ONE weighted sampler. Items and weights aligned by
// index, a seed and a dimension tag in, one item out — deterministically. The firehose
// chooser (recipe dimensions) and the selection fold (reproduction mode + parent draws)
// both draw through THIS. [LAW:one-source-of-truth] one picker, never a per-caller copy.
//
// [LAW:one-way-deps] Pure leaf over `hash`: no env, no I/O, no clock. seedFloat(seed, kind)
// → a uniform float in [0, total) that selects an index by cumulative sum. Same
// (items, weights, seed, kind) → same result, every time. The kind tag combines with the
// seed by independent avalanche (hash.ts), so distinct draws off one seed decorrelate by
// construction — no string-position assumption to get wrong.

import { seedFloat } from '~/lib/hash'

// [LAW:types-are-the-program] A zero (or negative) total is a configuration bug — the
// candidate pool has been emptied by over-aggressive weighting. Fail loud rather than
// silently fall back to a wrong item; the caller's invariant (some weight is positive)
// is the precondition this enforces at the boundary.
export function pickWeighted<T>(
  items: readonly T[],
  weights: readonly number[],
  seed: number,
  kind: string,
): T {
  if (items.length !== weights.length) {
    throw new Error(
      `pickWeighted: items.length=${items.length} != weights.length=${weights.length} (kind=${kind})`,
    )
  }
  let total = 0
  for (const w of weights) total += w
  if (!(total > 0)) {
    throw new Error(`pickWeighted: total weight not positive (kind=${kind}, total=${total})`)
  }
  const r = seedFloat(seed, kind) * total
  let acc = 0
  for (let i = 0; i < items.length; i++) {
    acc += weights[i]!
    if (r < acc) return items[i]!
  }
  return items[items.length - 1]!
}
