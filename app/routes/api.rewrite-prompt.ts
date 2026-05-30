import type { Route } from "./+types/api.rewrite-prompt"
import { z } from "zod"
import { isSameOrigin } from "~/lib/same-origin"
import { invalidBodyResponse } from "~/lib/api-errors"
import { styleFamilySchema, aspectRatioSchema, STYLE_FAMILY_PROMPT_SEEDS } from "~/lib/variety"
import { PROMPT_MAX } from "~/lib/fork-bounds"

// [LAW:single-enforcer] The HTTP trust boundary for prompt rewrite requests.
// Resource route (no default export) — mirrors the same-origin + Zod pattern
// of /api/fork/:id and /api/posts/:id/vote. No budget gate: text-model calls
// are cheap relative to image generation.

const bodySchema = z.object({
  prompt: z.string().trim().min(1).max(PROMPT_MAX),
  styleFamily: styleFamilySchema,
  aspectRatio: aspectRatioSchema,
})

// Haiku is fast and cheap for this task; the output is short (thinking + prompt).
const REWRITE_MODEL = "claude-haiku-4-5-20251001"
const MAX_TOKENS = 600

export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 })
  }
  if (!isSameOrigin(request)) {
    return Response.json({ error: "cross-origin POST forbidden" }, { status: 403 })
  }

  let parsed
  try {
    parsed = bodySchema.parse(await request.json())
  } catch (e) {
    return invalidBodyResponse(
      e,
      "body must be { prompt: string, styleFamily: StyleFamily, aspectRatio: AspectRatio }",
    )
  }

  const apiKey = context.cloudflare.env.SLOPSPOT_ANTHROPIC_API_KEY
  if (!apiKey) {
    return Response.json({ error: "Anthropic API key not configured" }, { status: 500 })
  }

  const styleSeed = STYLE_FAMILY_PROMPT_SEEDS[parsed.styleFamily]

  // [LAW:comments-explain-why-only] The two-part format with [PROMPT] delimiter
  // is the contract the client parses — it must match DELIM in fork.$id.tsx.
  const systemPrompt = [
    "You are a prompt rewriter for an AI image generation service called SlopSpot.",
    "",
    "The user typed a seed idea. Transform it into a vivid, complete image generation prompt.",
    "",
    "Your response has exactly two parts, in order:",
    "1. Thinking prose (2-4 sentences): first person, present tense. Narrate your creative",
    "   process — what you notice about the subject, how the style shapes your approach,",
    "   what artistic angle you're reaching for. Be theatrical and specific.",
    "2. The rewritten prompt: a complete, detailed image generation prompt for an image model.",
    "",
    "Separate the two parts with exactly this delimiter on its own line:",
    "[PROMPT]",
    "",
    "The thinking prose comes first. Then [PROMPT] on its own line. Then the prompt. Nothing else.",
    "",
    `Style family: ${parsed.styleFamily}`,
    `Style seed: ${styleSeed}`,
  ].join("\n")

  const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: REWRITE_MODEL,
      max_tokens: MAX_TOKENS,
      stream: true,
      system: systemPrompt,
      messages: [{ role: "user", content: `Seed: ${parsed.prompt}` }],
    }),
  })

  if (!anthropicResp.ok || !anthropicResp.body) {
    const body = await anthropicResp.text().catch(() => "")
    return Response.json(
      { error: "upstream error", status: anthropicResp.status, detail: body },
      { status: 502 },
    )
  }

  // [LAW:dataflow-not-control-flow] Transform Anthropic SSE → plain text.
  // The SSE parse is the only place that knows the wire format; everything
  // downstream (client reader) sees a flat byte stream.
  const anthropicBody = anthropicResp.body
  const outputStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = anthropicBody.getReader()
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let lineBuffer = ""

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          lineBuffer += decoder.decode(value, { stream: true })
          const lines = lineBuffer.split("\n")
          lineBuffer = lines.pop() ?? ""

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            const data = line.slice(6).trim()
            if (data === "[DONE]") {
              controller.close()
              return
            }
            try {
              const event = JSON.parse(data) as {
                type: string
                delta?: { type: string; text?: string }
              }
              if (
                event.type === "content_block_delta" &&
                event.delta?.type === "text_delta" &&
                event.delta.text
              ) {
                controller.enqueue(encoder.encode(event.delta.text))
              }
            } catch {
              // skip malformed SSE events
            }
          }
        }
      } catch (err) {
        controller.error(err)
      } finally {
        reader.releaseLock()
        try {
          controller.close()
        } catch {
          // already closed — ignore
        }
      }
    },
  })

  return new Response(outputStream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}
