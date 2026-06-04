// [LAW:behavior-not-structure] The breed action's TRUST-BOUNDARY contract — the guards unique to
// breeding that short-circuit before any D1 / provider / composer work, so they are hermetic:
//   - method must be POST (405);
//   - cross-origin POST is refused (403, the shared CSRF enforcer);
//   - a malformed body (no mateId) is rejected (400);
//   - a slop cannot breed with ITSELF (400) — the two parents must be distinct.
// The full 3-step assembly (breed → composePrompt → createPost bred 2-edge) is verified behaviorally
// against local dev (it needs D1 + a provider render), the same way the fork action's success path is.

import { describe, expect, it, vi } from "vitest"
import { action } from "../api.breed.$id"

// [LAW:behavior-not-structure] The two parent-validity guards (6.1's coverage gap) are hermetic by
// mocking the ONE read the action makes before any provider/composer/D1-write work — getPostById.
// A null parent → 404; a non-generation parent (no genome to cross) → 400. The heavier paths (422
// mock-in-prod, 201 + bred-2-edge) stay live-verified — they need provider/createPost mocks fork
// itself never built. The first four guards below short-circuit before getPostById, so this mock
// leaves them untouched.
vi.mock("~/db/feed", () => ({ getPostById: vi.fn() }))
import { getPostById } from "~/db/feed"

// The action only reaches context.cloudflare.env AFTER these guards, so a never-touched stub is
// honest here — a test that supplied a real env would imply these paths read it, which they do not.
const ctx = { cloudflare: { env: {} as Env } } as unknown as Parameters<typeof action>[0]["context"]

function post(id: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://slopspot.ai/api/breed/${id}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

async function run(request: Request, id: string) {
  return action({ request, params: { id }, context: ctx } as Parameters<typeof action>[0])
}

describe("api.breed.$id — trust boundary", () => {
  it("rejects a non-POST method with 405", async () => {
    const request = new Request("https://slopspot.ai/api/breed/a", { method: "GET" })
    const res = await run(request, "a")
    expect(res.status).toBe(405)
  })

  it("refuses a cross-origin POST with 403", async () => {
    const request = post("a", { mateId: "b" }, { origin: "https://evil.example" })
    const res = await run(request, "a")
    expect(res.status).toBe(403)
  })

  it("rejects a body missing mateId with 400", async () => {
    // Same-origin (no Origin header → treated same-origin by the shared enforcer).
    const res = await run(post("a", { notMate: "b" }), "a")
    expect(res.status).toBe(400)
  })

  it("refuses to breed a slop with ITSELF (400) — two parents must be distinct", async () => {
    const res = await run(post("same-id", { mateId: "same-id" }), "same-id")
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toMatch(/itself/i)
  })

  it("returns 404 when a parent is not found", async () => {
    vi.mocked(getPostById).mockResolvedValueOnce(null)
    const res = await run(post("a", { mateId: "b" }), "a")
    expect(res.status).toBe(404)
    const json = (await res.json()) as { error: string }
    expect(json.error).toMatch(/not found/i)
  })

  it("returns 400 when a parent is not a generation (no genome to cross)", async () => {
    // An upload carries no recipe — unbreedable. The action checks content.kind before any genome
    // read, so a minimal upload-shaped post is enough to exercise the guard.
    vi.mocked(getPostById).mockResolvedValueOnce({
      id: "a",
      content: { kind: "upload", asset: { kind: "image", url: "/media/x", w: 1, h: 1 } },
      origin: { kind: "uploaded", by: { kind: "anon", label: "anon-x" } },
    } as unknown as NonNullable<Awaited<ReturnType<typeof getPostById>>>)
    const res = await run(post("a", { mateId: "b" }), "a")
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toMatch(/generation/i)
  })
})
