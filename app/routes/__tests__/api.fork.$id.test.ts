// [LAW:behavior-not-structure] The fork action's failure CONTRACT: each distinct failure
// condition emits its own unambiguous machine-readable `cause` (and an honest HTTP status),
// so the visitor pause is selected from a signal that means exactly one thing — never a status
// like 502/422 that means several. The load-bearing case is `internal` vs `provider-upstream`:
// a deterministic server fault must NOT be dressed as a transient "try again" provider hiccup.
//
// Hermetic by mocking the boundaries the action crosses on each path — the same discipline as
// api.breed.$id.test.ts, extended to the provider/createPost catch arms this fix lives in.

import { describe, expect, it, vi, beforeEach } from "vitest"
import { z } from "zod"
import { ApiError } from "@fal-ai/client"

vi.mock("~/db/feed", () => ({ getPostById: vi.fn() }))
vi.mock("~/firehose/budget", () => ({ checkBudget: vi.fn() }))
vi.mock("~/agents/persona", () => ({ getPersonaByMedium: vi.fn() }))
// Keep the REAL error classes (instanceof is the route's discriminator) and override the lookups.
vi.mock("~/providers", async (orig) => ({
  ...(await orig<typeof import("~/providers")>()),
  getProvider: vi.fn(),
  realProviders: vi.fn(),
}))
vi.mock("~/db/posts", async (orig) => ({
  ...(await orig<typeof import("~/db/posts")>()),
  createPost: vi.fn(),
}))
vi.mock("~/lib/voter-cookie", () => ({
  resolveVoter: () => ({ voterId: "v1", setCookieHeader: null }),
}))

import { action } from "../api.fork.$id"
import { getPostById } from "~/db/feed"
import { checkBudget } from "~/firehose/budget"
import { getPersonaByMedium } from "~/agents/persona"
import { getProvider, realProviders, UnknownProviderError } from "~/providers"
import { createPost, InvalidParamsError } from "~/db/posts"
import { ProviderId } from "~/lib/domain"
import { resetCountersForTesting, snapshotCountersForTesting } from "~/observability/metrics"

// [LAW:behavior-not-structure] The fork action's OUTCOME contract: every terminal result — success
// or any cause — increments slopspot.fork.outcome{surface:fork, outcome} exactly once, so the
// server-authoritative counter (the success-ratio source the client pause beacon cannot give) can
// never drift from what the visitor received. Read the real emit() counter, not a mock of it.
function forkOutcomes(): Array<{ surface: string; outcome: string; value: number }> {
  return [...snapshotCountersForTesting().values()]
    .filter((e) => e.name === "slopspot.fork.outcome")
    .map((e) => ({ surface: String(e.labels.surface), outcome: String(e.labels.outcome), value: e.value }))
}

const PROVIDER = "fal-flux"

// A minimal authored, succeeded generation parent — only the fields the action reads on the
// fork path (content.kind, genome.genes.form/traits, origin.kind/author). `genes.form` is a
// real RecipeSubject (the T00 freeText shape) because the action renders it into the child's
// fallback placard via fallbackTitle on the way to createPost.
const genParent = {
  id: "parent1",
  content: {
    kind: "generation",
    genome: { genes: { form: { subjectTemplate: "T00", slots: { freeText: "a relic" } } }, traits: {} },
  },
  origin: { kind: "authored", author: { kind: "agent", agentId: "agent1" } },
} as unknown as NonNullable<Awaited<ReturnType<typeof getPostById>>>

const ctx = { cloudflare: { env: {} as Env } } as unknown as Parameters<typeof action>[0]["context"]

function post(body: unknown): Request {
  return new Request(`https://slopspot.ai/api/fork/parent1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const validBody = {
  prompt: "a quiet field at dusk",
  styleFamily: "oil-painting",
  aspectRatio: "1:1",
  providerId: PROVIDER,
}

async function run(body: unknown = validBody) {
  return action({ request: post(body), params: { id: "parent1" }, context: ctx } as Parameters<typeof action>[0])
}

async function expectCause(res: Response, status: number, cause: string) {
  expect(res.status).toBe(status)
  const json = (await res.json()) as { cause?: string }
  expect(json.cause).toBe(cause)
  // The outcome label IS the cause — one emission, surface fork, value 1.
  expect(forkOutcomes()).toEqual([{ surface: "fork", outcome: cause, value: 1 }])
}

// Past the parent + budget guards, into the provider/createPost section, with a happy provider.
function reachCreatePost() {
  vi.mocked(getPostById).mockResolvedValue(genParent)
  vi.mocked(checkBudget).mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 10 } as Awaited<ReturnType<typeof checkBudget>>)
  vi.mocked(getProvider).mockReturnValue({ id: ProviderId(PROVIDER), defaultParamsForRecipe: () => ({}) } as unknown as ReturnType<typeof getProvider>)
  vi.mocked(realProviders).mockReturnValue([{ id: ProviderId(PROVIDER) }] as unknown as ReturnType<typeof realProviders>)
  vi.mocked(getPersonaByMedium).mockResolvedValue(null)
}

describe("api.fork.$id — each failure emits an unambiguous cause", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetCountersForTesting()
  })

  it("createPost succeeds → 201 and emits fork.outcome success", async () => {
    reachCreatePost()
    vi.mocked(createPost).mockResolvedValue({ id: "child1" } as Awaited<ReturnType<typeof createPost>>)
    const res = await run()
    expect(res.status).toBe(201)
    expect(forkOutcomes()).toEqual([{ surface: "fork", outcome: "success", value: 1 }])
  })

  it("parent missing → 404 parent-not-found", async () => {
    vi.mocked(getPostById).mockResolvedValue(null)
    await expectCause(await run(), 404, "parent-not-found")
  })

  it("budget check throws → 503 budget-unavailable", async () => {
    vi.mocked(getPostById).mockResolvedValue(genParent)
    vi.mocked(checkBudget).mockRejectedValue(new Error("D1 down"))
    await expectCause(await run(), 503, "budget-unavailable")
  })

  it("over budget → 429 budget-exhausted", async () => {
    vi.mocked(getPostById).mockResolvedValue(genParent)
    vi.mocked(checkBudget).mockResolvedValue({ withinBudget: false, spentUsd: 11, ceilingUsd: 10 } as Awaited<ReturnType<typeof checkBudget>>)
    await expectCause(await run(), 429, "budget-exhausted")
  })

  it("unknown provider id → 404 provider-not-registered", async () => {
    vi.mocked(getPostById).mockResolvedValue(genParent)
    vi.mocked(checkBudget).mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 10 } as Awaited<ReturnType<typeof checkBudget>>)
    vi.mocked(getProvider).mockImplementation(() => { throw new UnknownProviderError(ProviderId(PROVIDER)) })
    await expectCause(await run(), 404, "provider-not-registered")
  })

  it("provider not available in this environment → 422 provider-unavailable", async () => {
    vi.mocked(getPostById).mockResolvedValue(genParent)
    vi.mocked(checkBudget).mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 10 } as Awaited<ReturnType<typeof checkBudget>>)
    vi.mocked(getProvider).mockReturnValue({ id: ProviderId(PROVIDER), defaultParamsForRecipe: () => ({}) } as unknown as ReturnType<typeof getProvider>)
    vi.mocked(realProviders).mockReturnValue([] as unknown as ReturnType<typeof realProviders>)
    await expectCause(await run(), 422, "provider-unavailable")
  })

  it("createPost throws InvalidParamsError → 422 invalid-params", async () => {
    reachCreatePost()
    const zodErr = z.object({ a: z.string() }).safeParse({ a: 1 })
    vi.mocked(createPost).mockRejectedValue(new InvalidParamsError(ProviderId(PROVIDER), (zodErr as { error: z.ZodError }).error))
    await expectCause(await run(), 422, "invalid-params")
  })

  it("createPost throws ApiError (upstream) → 502 provider-upstream (transient; retry is honest)", async () => {
    reachCreatePost()
    vi.mocked(createPost).mockRejectedValue(new ApiError({ message: "upstream 500", status: 500, body: "x", requestId: "r" }))
    await expectCause(await run(), 502, "provider-upstream")
  })

  it("createPost throws a generic Error → 500 internal, NOT 502 (the load-bearing split)", async () => {
    // [LAW:no-silent-failure] A deterministic server fault (bug / R2 / D1) must never be dressed
    // as the transient provider-upstream hiccup — the old shared 502 told the visitor "try again"
    // when retrying could not help. This is the exact regression this ticket exists to prevent.
    reachCreatePost()
    vi.mocked(createPost).mockRejectedValue(new Error("undefined is not a function"))
    const res = await run()
    await expectCause(res, 500, "internal")
    expect(res.status).not.toBe(502)
  })

  it("createPost throws UnknownProviderError (HMR race) → 404 provider-not-registered", async () => {
    reachCreatePost()
    vi.mocked(createPost).mockRejectedValue(new UnknownProviderError(ProviderId(PROVIDER)))
    await expectCause(await run(), 404, "provider-not-registered")
  })
})
