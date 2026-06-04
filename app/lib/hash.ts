// [LAW:one-source-of-truth] The city's ONE deterministic hash. Four modules expand a seed into
// reproducible choices — the firehose chooser (recipe selection), the persona picker (which citizen
// fires), the scheduler (whether an agent fires this tick), and the breed fold (per-gene crossover
// coins + per-axis trait mix/drift). One implementation, no drift between streams that must stay
// uncorrelated across modules. [LAW:single-enforcer]
//
// [LAW:types-are-the-program] The public API is `seedHash(seed, ...tags)` / `seedFloat(...)`: a seed
// plus discriminator tags, COMBINED BY INDEPENDENT AVALANCHE — never string concatenation. This
// makes the dimension-correlation bug UNCONSTRUCTIBLE *and position-independent*. The earlier
// `${a}:${b}` string-concat form correlated depending on WHERE two keys diverged and the seed's
// magnitude: discriminator-first re-correlated small breed seeds (~4.8σ), and discriminator-last
// re-correlated future prefix-sharing scheduler agentIds (~318σ). Both are the SAME flaw — a single
// FNV pass over a concatenation lets shared bytes (a shared seed suffix, a shared agentId prefix)
// pull two streams together. The fix removes concatenation entirely: each component is avalanched
// from clean state (fmix32 spreads small integer seeds; fnv1a32 hashes each tag), then folded by a
// nonlinear, ORDER-SENSITIVE murmur3 step. So two discriminators of one seed are genuinely
// different functions of it (measured max cross-stream |r| ≤ 0.094 across integer/timestamp/prefix
// regimes, vs ~0.3–1.0 for every concat/XOR variant — see hash.test.ts). "Where do the keys
// diverge" is no longer expressible; kind-first vs seed-first is a non-question.
//
// [LAW:one-way-deps] Pure leaf: no imports, no I/O, no clock. Everything above depends down into it.

const u32 = (x: number): number => x >>> 0
const rotl = (x: number, r: number): number => u32((x << r) | (x >>> (32 - r)))

// FNV-1a 32-bit over a string — the per-TAG primitive, INTERNAL ONLY. Not exported: a public string
// hash would re-admit the concatenation the combine exists to forbid. Tags reach the combine through
// seedHash, never as a hand-built key.
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

// murmur3 32-bit finalizer — avalanches an integer so a 1-bit input change flips ~half the output
// bits. This is what spreads small integer seeds (breed's 0,1,2,…) that a single FNV pass leaves
// clustered in the low bits. Constants are murmur3's (0x85ebca6b / 0xc2b2ae35).
function fmix32(h: number): number {
  h = u32(h)
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

// murmur3 32-bit body step — mix one 32-bit block `k` into the accumulator `h`. Nonlinear and
// ORDER-SENSITIVE (the rotate+multiply chain is not commutative), so combining tags in a different
// order yields a different hash: seedHash(s,'gene','axis') ≠ seedHash(s,'axis','gene') by
// construction. Constants are murmur3's (0xcc9e2d51 / 0x1b873593 / 5 / 0xe6546b64).
function mix(h: number, k: number): number {
  k = Math.imul(k, 0xcc9e2d51)
  k = rotl(k, 15)
  k = Math.imul(k, 0x1b873593)
  h ^= k
  h = rotl(h, 13)
  h = u32(Math.imul(h, 5) + 0xe6546b64)
  return h >>> 0
}

// [LAW:types-are-the-program] Hash a seed + discriminator tags into a reproducible uint32 by
// INDEPENDENT AVALANCHE: finalize the seed, fold each tag's full hash through the order-sensitive
// murmur step, finalize again. `seed` is the entropy (the tick, the breed seed — a number, so it
// can carry no separator and no tag can precede it); `tags` name the dimension ('mix','austerity').
// Same (seed, ...tags) → same hash, every time.
export function seedHash(seed: number, ...tags: string[]): number {
  let h = fmix32(seed)
  for (const tag of tags) h = mix(h, fnv1a32(tag))
  return fmix32(h)
}

// A uniform float in [0, 1) from the same combine — the hash mapped onto the unit interval (2^32 is
// the full range of the uint32). The chooser's weighted picker, the scheduler's fire bucket, and the
// breed fold's mix/drift all read positions this way. [LAW:one-source-of-truth]
export function seedFloat(seed: number, ...tags: string[]): number {
  return seedHash(seed, ...tags) / 0x100000000
}
