// [LAW:one-source-of-truth] The fork-prompt upper bound. One symbol, one
// value, imported by both the wire body schema (app/routes/api.fork.$id.ts)
// and the loader's pre-fill schema (app/routes/fork.$id.tsx).
//
// Lives in app/lib/ rather than at one of the route files because fork.$id.tsx
// is a client-bundled page route — importing from api.fork.$id.ts would
// transitively pull its server-only deps (`@fal-ai/client`, `~/db/posts`,
// `~/firehose/budget`) into the browser bundle. A shared lib module keeps the
// client/server boundary clean: this file has zero server imports, so a
// client-side import of `~/lib/fork-bounds` is a leaf in the module graph.
//
// SDXL and ideogram store prompts up to 1000 chars; fal-flux up to 500. The
// fork bound at 1000 accepts every stored row and never silently truncates.
export const PROMPT_MAX = 1000
