// [LAW:one-source-of-truth] The city's ONE deterministic hash. Three modules need the
// same FNV-1a expansion of a seed string into reproducible choices — the firehose chooser
// (recipe selection), the persona picker (which citizen fires), and the breed fold (per-gene
// crossover coins + per-axis trait mix/drift). Before there were three importers this lived
// duplicated in two of them with a comment conceding the dup; the third consumer (breed) makes
// the shared home the smoother shape — one implementation, no drift between the streams that
// must stay uncorrelated across modules. [LAW:single-enforcer]
//
// [LAW:one-way-deps] Pure leaf: no imports, no I/O, no clock. Everything above it depends
// down into it; it depends on nothing.

// FNV-1a 32-bit over a string. Deterministic: same input, same 32-bit unsigned result, every time.
//
// [LAW:one-source-of-truth] KEY ORDER DISCIPLINE — seed FIRST, discriminator LAST. To sample
// several dimensions independently from one seed, the caller writes `${seed}:${dimension}` —
// `42:gene:species` vs `42:gene:form`. These diverge in their TRAILING bytes, so FNV-1a's
// avalanche separates them and the two draws are uncorrelated. The INVERSE order is a TRAP: a
// discriminator-first key like `gene:species:42` vs `gene:form:42` shares the `:42` suffix, and
// re-processing identical trailing bytes through the same xor-multiply steps partially
// RE-CORRELATES the two streams (measured at ~4.8σ — a live firehose defect when it shipped). Never
// put a dimension tag before the seed; the seed is always the prefix, the dimensions always the
// suffix. (That this discipline is a convention a caller must remember — and got written WRONG in
// this very comment once — is exactly why the seed-first key becomes API-enforced downstream.)
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

// A uniform float in [0, 1) from a seed-first key (see the order discipline above) — the hash
// mapped onto the unit interval (2^32 is the full range of fnv1a32's unsigned output). The
// chooser's weighted picker and the breed fold's trait mix/drift both read positions this way; one
// normalization, so "a uniform [0,1) from a seed" means the same thing everywhere. [LAW:one-source-of-truth]
export function unitFloat(input: string): number {
  return fnv1a32(input) / 0x100000000
}
