// [LAW:one-source-of-truth] The delimiter that splits the LLM rewrite stream
// into thinking prose (pre) and rewritten prompt (post). api.rewrite-prompt.ts
// embeds it in the system prompt; fork.$id.tsx parses the stream against it.
// One value, two consumers — a tweak here propagates to both automatically.
export const REWRITE_DELIMITER = "[PROMPT]"
