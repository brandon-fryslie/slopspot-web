// [LAW:behavior-not-structure] Pins getPulse's contract — what event stream it
// derives for a given storage state — against a real D1 isolate, not a mock. The
// storage→domain discipline (origin_json parse, agent-vote discriminator,
// persona-name resolution, fail-loud) only matters if real rows round-trip
// through it, so the test seeds raw rows the way the live writers do.

import { describe, expect, it } from "vitest"
import { env } from "cloudflare:test"
import { getPulse } from "~/db/pulse"

async function seedPersona(agentId: string, displayName: string) {
  await env.DB.prepare(
    "INSERT INTO personas (agent_id, handle, display_name, role, persona_prompt, model_id, config_json, created_at) VALUES (?, NULL, ?, 'generator', 'p', 'm', '{}', 1)",
  )
    .bind(agentId, displayName)
    .run()
}

async function seedPost(opts: {
  id: string
  createdAt: number
  contentKind: "generation" | "found"
  originJson: string
}) {
  await env.DB.prepare(
    "INSERT INTO posts (id, created_at, content_kind, origin_json) VALUES (?, ?, ?, ?)",
  )
    .bind(opts.id, opts.createdAt, opts.contentKind, opts.originJson)
    .run()
}

async function seedFound(postId: string, title: string) {
  await env.DB.prepare(
    "INSERT INTO found (post_id, url, title, description, thumbnail_json) VALUES (?, 'https://example.com/x', ?, NULL, NULL)",
  )
    .bind(postId, title)
    .run()
}

async function seedVote(opts: {
  postId: string
  voterId: string
  value: number
  reasoning: string | null
  createdAt: number
}) {
  await env.DB.prepare(
    "INSERT INTO votes (post_id, voter_id, value, created_at, reasoning) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(opts.postId, opts.voterId, opts.value, opts.createdAt, opts.reasoning)
    .run()
}

const authored = (agentId: string) =>
  JSON.stringify({ kind: "authored", author: { kind: "agent", agentId } })
const foundBy = (agentId: string) =>
  JSON.stringify({ kind: "found", finder: { kind: "agent", agentId } })

describe("app/db/pulse.ts - getPulse", () => {
  it("returns [] when nothing has happened", async () => {
    expect(await getPulse(env)).toEqual([])
  })

  it("derives posted/rescued/blessed/buried, most-recent first, with persona names", async () => {
    await seedPersona("agent:maker", "Hieronymus")
    await seedPersona("agent:judge", "The Appraiser")
    await seedPersona("agent:critic", "Sister Ash")
    await seedPersona("agent:digger", "The Ragpicker")

    await seedPost({ id: "p_gen1", createdAt: 500, contentKind: "generation", originJson: authored("agent:maker") })
    await seedPost({ id: "p_gen2", createdAt: 1000, contentKind: "generation", originJson: authored("agent:maker") })
    await seedPost({ id: "p_found", createdAt: 2000, contentKind: "found", originJson: foundBy("agent:digger") })
    await seedFound("p_found", "a salvaged jpeg")

    await seedVote({ postId: "p_gen1", voterId: "agent:judge", value: 1, reasoning: "the light is honest", createdAt: 3000 })
    await seedVote({ postId: "p_gen1", voterId: "agent:critic", value: -1, reasoning: "derivative", createdAt: 4000 })

    // excluded: a human vote (no reasoning) and a post by an unseeded agent.
    await seedVote({ postId: "p_gen1", voterId: "human-cookie", value: 1, reasoning: null, createdAt: 5000 })
    await seedPost({ id: "p_cron", createdAt: 1500, contentKind: "generation", originJson: authored("sys:slop-cron") })

    expect(await getPulse(env)).toEqual([
      { kind: "buried", ts: 4000, persona: "Sister Ash", postId: "p_gen1", title: "a piece", reasoning: "derivative" },
      { kind: "blessed", ts: 3000, persona: "The Appraiser", postId: "p_gen1", title: "a piece", reasoning: "the light is honest" },
      { kind: "rescued", ts: 2000, persona: "The Ragpicker", postId: "p_found" },
      { kind: "posted", ts: 1000, persona: "Hieronymus", postId: "p_gen2", title: "a piece" },
      { kind: "posted", ts: 500, persona: "Hieronymus", postId: "p_gen1", title: "a piece" },
    ])
  })

  it("surfaces a found post's title when an agent votes on it", async () => {
    await seedPersona("agent:judge", "The Appraiser")
    await seedPost({ id: "p_found", createdAt: 1000, contentKind: "found", originJson: foundBy("agent:judge") })
    await seedFound("p_found", "a salvaged jpeg")
    await seedVote({ postId: "p_found", voterId: "agent:judge", value: 1, reasoning: "good bones", createdAt: 2000 })

    const events = await getPulse(env)
    const blessed = events.find((e) => e.kind === "blessed")
    expect(blessed).toEqual({
      kind: "blessed",
      ts: 2000,
      persona: "The Appraiser",
      postId: "p_found",
      title: "a salvaged jpeg",
      reasoning: "good bones",
    })
  })

  it("excludes posts whose author has no persona (named residents only)", async () => {
    await seedPost({ id: "p_cron", createdAt: 1000, contentKind: "generation", originJson: authored("sys:slop-cron") })
    expect(await getPulse(env)).toEqual([])
  })
})
