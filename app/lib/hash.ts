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

// FNV-1a 32-bit over a string. The CALLER kind-tags the input (e.g. `gene:species:42`,
// `style:42`) so independent dimensions sample uncorrelated from the same seed —
// fnv1a32('gene:species:42') and fnv1a32('gene:form:42') are unrelated, so a child's
// species inheritance never constrains its form inheritance. Deterministic: same input,
// same 32-bit unsigned result, every time.
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

// A uniform float in [0, 1) from a kind-tagged seed string — the hash mapped onto the unit
// interval (2^32 is the full range of fnv1a32's unsigned output). The chooser's weighted
// picker and the breed fold's trait mix/drift both read positions this way; one normalization,
// so "a uniform [0,1) from a seed" means the same thing everywhere. [LAW:one-source-of-truth]
export function unitFloat(input: string): number {
  return fnv1a32(input) / 0x100000000
}
