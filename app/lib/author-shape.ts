// [LAW:one-source-of-truth] The discriminator the injectable fake author (app/lib/haiku.ts
// getAuthor) keys on to return shape-valid output for each caller's parser. Every LLM-prompt
// builder embeds EXACTLY ONE of these tokens on its existing output-contract line; the dev-only
// fake reads it to pick the matching corpus (persona JSON / {title,prompt} JSON / a verdict line).
//
// A shared, importable home so the producer prompts and the consumer classifier read the SAME
// literal, and so the pure voice layer can carry the verdict token WITHOUT depending on the
// Anthropic transport leaf. [LAW:one-way-deps] Pure leaf: a frozen literal, no imports, no I/O.
//
// To the REAL model these are inert instruction-envelope tag noise (the model ignores them); they
// are load-bearing only when the fake is selected (SLOPSPOT_ENV === 'dev').
export const AUTHOR_SHAPE = {
  persona: '[[author-shape:persona]]',
  composed: '[[author-shape:composed]]',
  verdict: '[[author-shape:verdict]]',
} as const

export type AuthorShape = keyof typeof AUTHOR_SHAPE
