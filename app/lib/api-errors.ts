import { ZodError } from "zod"

// [LAW:single-enforcer] One shape for invalid-body 400 responses, shared across
// every cookie-auth POST route that does Zod parse + reject. The first version
// of /api/posts/:id/vote serialized the raw exception with `String(e)`, which
// for ZodError leaks a verbose stack-string into the response body — useful as
// recon for an attacker probing the API, noisy for legitimate clients.
//
// [LAW:types-are-the-program] The closed discriminator is "is this a Zod
// validation failure, or some other parse failure (e.g. malformed JSON)?" The
// switch absorbs that variance once; callers don't branch on the exception's
// type, they just pass it through and supply a route-specific hint about the
// expected shape. ZodError's own `.issues` array is the structured, safe
// representation Zod is designed to surface — no JS stack-strings.

export function invalidBodyResponse(e: unknown, hint: string): Response {
  if (e instanceof ZodError) {
    return Response.json(
      { error: "invalid body", issues: e.issues, hint },
      { status: 400 },
    )
  }
  // Malformed JSON or any non-Zod parse failure: do not echo the underlying
  // message, since `String(e)` can include host/runtime-specific text. The hint
  // is the documented expected shape; that is enough for a legitimate caller
  // to recover and not enough for an attacker to map internals.
  return Response.json(
    { error: "invalid body", hint },
    { status: 400 },
  )
}
