import type { Route } from "./+types/api.rewrite-prompt"
import { z } from "zod"
import { isSameOrigin } from "~/lib/same-origin"
import { invalidBodyResponse } from "~/lib/api-errors"
import { styleFamilySchema, aspectRatioSchema, STYLE_FAMILY_PROMPT_SEEDS } from "~/lib/variety"
import { PROMPT_MAX } from "~/lib/fork-bounds"
import { REWRITE_DELIMITER } from "~/lib/rewrite-delim"

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
// Mirrors the REQUEST_TIMEOUT_MS in app/firehose/composer.ts — same upstream,
// same bound. Protects against Anthropic stalling before sending headers.
const REQUEST_TIMEOUT_MS = 15_000

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

  // Human-readable aspect label mirrors the composer's mapping so the LLM
  // gets concrete framing rather than the raw ratio string.
  const aspectLabel =
    parsed.aspectRatio === "1:1" ? "square"
    : parsed.aspectRatio === "16:9" ? "wide landscape"
    : parsed.aspectRatio === "9:16" ? "tall portrait"
    : parsed.aspectRatio === "4:3" ? "landscape"
    : "portrait (3:4)"

  // [LAW:one-source-of-truth] REWRITE_DELIMITER is the shared contract between
  // this system prompt and the client-side stream parser in fork.$id.tsx.
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
    REWRITE_DELIMITER,
    "",
    `The thinking prose comes first. Then ${REWRITE_DELIMITER} on its own line. Then the prompt. Nothing else.`,
    "",
    `Style family: ${parsed.styleFamily}`,
    `Style seed: ${styleSeed}`,
    `Aspect ratio: ${aspectLabel} — let this shape composition language where relevant.`,
  ].join("\n")

  // Combined abort: fires on client disconnect (request.signal) OR on timeout.
  // Protects against both Anthropic stalling before headers and orphaned
  // workers after the user navigates away.
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS)
  request.signal.addEventListener("abort", () => timeoutController.abort(), { once: true })

  let anthropicResp: Response
  try {
    anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
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
      signal: timeoutController.signal,
    })
  } catch (err) {
    return Response.json({ error: "upstream request failed", detail: String(err) }, { status: 502 })
  } finally {
    clearTimeout(timeoutId)
  }

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
  // Hoisted so the cancel() callback can reach the upstream reader when the
  // client disconnects mid-stream and aborts the fetch.
  let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const outputStream = new ReadableStream<Uint8Array>({
    async start(controller) {
      upstreamReader = anthropicBody.getReader()
      const reader = upstreamReader
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let lineBuffer = ""

      try {
        while (true) {
          const { done, value } = await reader.read()

          // On done, flush the decoder's internal buffer for any partial UTF-8
          // sequence; on non-done, accumulate with stream mode so multi-byte
          // sequences spanning chunks are reassembled correctly.
          lineBuffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
          const lines = lineBuffer.split("\n")
          // On EOF, process every line (including unterminated final line);
          // mid-stream, hold the last line back until it's newline-terminated.
          lineBuffer = done ? "" : (lines.pop() ?? "")

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

          if (done) break
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
    cancel() {
      upstreamReader?.cancel()
    },
  })

  return new Response(outputStream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}
