import type { Route } from "./+types/api.found"
import { z } from "zod"
import { createPost } from "~/db/posts"
import { resolveVoter } from "~/lib/voter-cookie"
import { isSameOrigin } from "~/lib/same-origin"
import { invalidBodyResponse } from "~/lib/api-errors"
import { tryReserveFoundSubmission } from "~/lib/found-quota"
import { authorLabel } from "~/lib/author-label"
import type { Origin } from "~/lib/domain"

// [LAW:single-enforcer] The HTTP JSON trust boundary for found-content
// submission. The HTML form at /submit has its own action handler that owns
// form-encoded parsing + redirect-on-success; this route is the wire shape
// agents (svq.5 discovery personas) and JS-enhanced clients consume.
// Both routes pass through the same writer (~/db/posts createPost) and the
// same per-voter quota (~/lib/found-quota), so the storage invariants are
// identical regardless of which entry point the post arrived through.
//
// Verification order: method → same-origin (CSRF gate shared with /vote and
// /comments) → body parse (Zod) → voter id resolve → quota reservation →
// createPost. Each layer enforced once here and nowhere else.
//
// [LAW:types-are-the-program] The wire shape forbids by construction:
//   url:   http(s)-only URL, max 4096. `z.url({ protocol: /^https?$/ })`
//          rejects `javascript:`, `data:`, `file:`, `vbscript:` — every
//          XSS-capable scheme — at the boundary, so by the time
//          `FoundLinkCard` renders `<a href={url}>` no stored value can
//          execute script on click. The XSS class is unrepresentable
//          downstream; no defensive renderer guard needed.
//   title: trimmed, 1..300 — whitespace-only titles fail by length, not by
//          a separate guard, and the cap stops storage-row bloat
//   description?: trimmed, max 2000, empty-after-trim normalized to absent
//          (preprocess → undefined → optional). The strongest true theorem
//          about the domain is "description is either absent OR a non-empty
//          trimmed string"; the preprocess makes the in-between state
//          (defined but blank) unrepresentable, so getFeed / PostCard cannot
//          render an empty <p> tag for a "" stored description.
//
// 1..300 is the same shape comments uses for body (z.string().trim().min(1).max(2000));
// titles are headlines, so the cap is tighter.
const bodySchema = z.object({
  url: z.url({ protocol: /^https?$/ }).max(4096),
  title: z.string().trim().min(1).max(300),
  description: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length === 0 ? undefined : v),
    z.string().trim().max(2000).optional(),
  ),
})

export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 })
  }

  // [LAW:single-enforcer] Same-origin gate shared with /vote and /comments —
  // a cookie-auth POST without an Origin check is a CSRF target. /api/generate
  // uses the challenge gate instead and intentionally does not call this.
  if (!isSameOrigin(request)) {
    return Response.json({ error: "cross-origin POST forbidden" }, { status: 403 })
  }

  let parsed
  try {
    parsed = bodySchema.parse(await request.json())
  } catch (e) {
    return invalidBodyResponse(
      e,
      "POST { url: string (URL), title: string (1..300 after trim), description?: string (<=2000 after trim) }",
    )
  }

  const voter = resolveVoter(request)

  // [LAW:single-enforcer] Per-voter quota enforced at exactly one place. The
  // /submit form route calls the same reservation function before its own
  // createPost call, so the cap holds regardless of submission path.
  const reservation = await tryReserveFoundSubmission(
    context.cloudflare.env,
    voter.voterId,
  )
  if (reservation.kind === "exhausted") {
    return Response.json(
      { error: "rate limited", retryAfter: reservation.retryAfter },
      { status: 429 },
    )
  }

  // [LAW:single-enforcer] authorLabel() in ~/lib/author-label is the one
  // place a voter UUID becomes its anonymous display string. Calling it
  // here keeps every anon Actor's label uniform with comments/votes
  // attribution — drift would mean two label formats coexist in the same
  // database. Persona-attributed submissions (svq.5) construct a different
  // Actor variant via the same writer.
  const origin: Origin = {
    actor: { kind: "anon", label: authorLabel(voter.voterId) },
  }

  const post = await createPost(
    {
      kind: "found",
      url: parsed.url,
      title: parsed.title,
      ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      origin,
    },
    { env: context.cloudflare.env },
  )

  const headers = new Headers({ "content-type": "application/json" })
  if (voter.setCookieHeader !== null) {
    headers.set("set-cookie", voter.setCookieHeader)
  }
  return new Response(JSON.stringify({ id: post.id }), { status: 201, headers })
}
