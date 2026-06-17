// [LAW:behavior-not-structure] The breed action's TRUST-BOUNDARY contract — the guards unique to
// breeding that short-circuit before any D1 / provider / composer work, so they are hermetic:
//   - method must be POST (405);
//   - cross-origin POST is refused (403, the shared CSRF enforcer);
//   - a malformed body (no mateId) is rejected (400);
//   - a slop cannot breed with ITSELF (400) — the two parents must be distinct.
// The full 3-step assembly (breed → composePrompt → createPost bred 2-edge) is verified behaviorally
// against local dev (it needs D1 + a provider render), the same way the fork action's success path is.

import { describe, expect, it, vi, beforeEach } from "vitest"
import { ApiError } from "@fal-ai/client"
import { action } from "../api.breed.$id"

// [LAW:behavior-not-structure] The two parent-validity guards (6.1's coverage gap) are hermetic by
// mocking the ONE read the action makes before any provider/composer/D1-write work — getPostById.
// A null parent → 404; a non-generation parent (no genome to cross) → 400. The breed-authoring
// catch arms (each thrown type → its unambiguous cause) are mocked at authorBredSlop, the ONE call
// the try block makes — mirroring api.fork.$id's coverage of the same failure taxonomy.
vi.mock("~/db/feed", () => ({ getPostById: vi.fn() }))
vi.mock("~/firehose/budget", () => ({ checkBudget: vi.fn() }))
// Keep the REAL error classes (instanceof is the route's discriminator) and override the assembly.
vi.mock("~/agents/generator", async (orig) => ({
  ...(await orig<typeof import("~/agents/generator")>()),
  authorBredSlop: vi.fn(),
}))
vi.mock("~/lib/voter-cookie", () => ({
  resolveVoter: () => ({ voterId: "v1", setCookieHeader: null }),
}))
import { getPostById } from "~/db/feed"
import { checkBudget } from "~/firehose/budget"
import { authorBredSlop, BredMediumUnavailableError } from "~/agents/generator"
import { InvalidParamsError } from "~/db/posts"
import { UnknownProviderError } from "~/providers"
import { ProviderId } from "~/lib/domain"
import { z } from "zod"

// A minimal authored generation parent — authorBredSlop is mocked, so only the breedable() guards
// read these fields (content.kind, origin.kind/author); the genome is passed straight through.
const genParent = {
  id: "p",
  content: { kind: "generation", genome: { genes: {}, traits: {} } },
  origin: { kind: "authored", author: { kind: "agent", agentId: "a1" } },
} as unknown as NonNullable<Awaited<ReturnType<typeof getPostById>>>

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

  it("returns 404 + parent-not-found cause when a parent is not found", async () => {
    vi.mocked(getPostById).mockResolvedValueOnce(null)
    const res = await run(post("a", { mateId: "b" }), "a")
    expect(res.status).toBe(404)
    const json = (await res.json()) as { error: string; cause: string }
    expect(json.error).toMatch(/not found/i)
    expect(json.cause).toBe("parent-not-found")
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

describe("api.breed.$id — the breed-authoring catch arms emit unambiguous causes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Both parents are valid authored generations; budget is within cap — so the action reaches
    // the authorBredSlop call, where each failure type is injected below.
    vi.mocked(getPostById).mockResolvedValue(genParent)
    vi.mocked(checkBudget).mockResolvedValue({
      withinBudget: true,
      spentUsd: 0,
      ceilingUsd: 10,
    } as Awaited<ReturnType<typeof checkBudget>>)
  })

  async function expectCause(status: number, cause: string) {
    const res = await run(post("a", { mateId: "b" }), "a")
    expect(res.status).toBe(status)
    const json = (await res.json()) as { cause?: string }
    expect(json.cause).toBe(cause)
  }

  it("over budget → 429 budget-exhausted", async () => {
    vi.mocked(checkBudget).mockResolvedValue({
      withinBudget: false,
      spentUsd: 11,
      ceilingUsd: 10,
    } as Awaited<ReturnType<typeof checkBudget>>)
    await expectCause(429, "budget-exhausted")
  })

  it("budget check throws → 503 budget-unavailable", async () => {
    vi.mocked(checkBudget).mockRejectedValue(new Error("D1 down"))
    await expectCause(503, "budget-unavailable")
  })

  it("UnknownProviderError → 404 provider-not-registered", async () => {
    vi.mocked(authorBredSlop).mockRejectedValue(new UnknownProviderError(ProviderId("fal-flux")))
    await expectCause(404, "provider-not-registered")
  })

  it("BredMediumUnavailableError → 422 provider-unavailable", async () => {
    vi.mocked(authorBredSlop).mockRejectedValue(new BredMediumUnavailableError(ProviderId("fal-flux")))
    await expectCause(422, "provider-unavailable")
  })

  it("InvalidParamsError → 422 invalid-params", async () => {
    const zodErr = z.object({ a: z.string() }).safeParse({ a: 1 })
    vi.mocked(authorBredSlop).mockRejectedValue(
      new InvalidParamsError(ProviderId("fal-flux"), (zodErr as { error: z.ZodError }).error),
    )
    await expectCause(422, "invalid-params")
  })

  it("ApiError (upstream) → 502 provider-upstream (transient; retry is honest)", async () => {
    vi.mocked(authorBredSlop).mockRejectedValue(
      new ApiError({ message: "upstream 500", status: 500, body: "x", requestId: "r" }),
    )
    await expectCause(502, "provider-upstream")
  })

  it("a generic Error → 500 internal, NOT 502 (the load-bearing split)", async () => {
    // [LAW:no-silent-failure] A deterministic server fault must never be voiced as the transient
    // provider-upstream "try again" — the exact conflation this ticket removes, on the breed surface.
    vi.mocked(authorBredSlop).mockRejectedValue(new Error("undefined is not a function"))
    const res = await run(post("a", { mateId: "b" }), "a")
    expect(res.status).toBe(500)
    expect((await res.json() as { cause: string }).cause).toBe("internal")
  })
})
