// [LAW:behavior-not-structure] Pins getPulse's contract — what event stream it
// derives for a given storage state — against a real D1 isolate, not a mock. The
// storage→domain discipline (origin_json parse, agent-vote discriminator,
// persona-name resolution, fail-loud) only matters if real rows round-trip
// through it, so the test seeds raw rows the way the live writers do.

import { describe, expect, it } from "vitest"
import { env } from "cloudflare:test"
import { getPulse } from "~/db/pulse"

// The home loader's single clock, threaded into getPulse. Jan 15 (DOM 15) — a saint
// canonised on the 15th of any month feasts today; everything else does not.
const NOW = Date.UTC(2026, 0, 15, 12)

async function seedCrown(opts: {
  id: string
  postId: string
  riteDay: string
  lens: string
  presiding: string
}) {
  await env.DB.prepare(
    "INSERT INTO crowns (id, post_id, rite_day, lens, presiding, decree_json, created_at) VALUES (?, ?, ?, ?, ?, ?, 1)",
  )
    .bind(opts.id, opts.postId, opts.riteDay, opts.lens, opts.presiding, JSON.stringify({ kind: "spoke", text: "Crowned." }))
    .run()
}

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

// A Proprietor birth utterance the way recordUtterance writes it (occasion='birth', no post target).
async function seedBirthUtterance(text: string, createdAt: number) {
  await env.DB.prepare(
    "INSERT INTO utterances (id, speaker, occasion, target_post_id, kind, text, withheld_reason, created_at) VALUES (?, 'agent:the-proprietor', 'birth', NULL, 'spoke', ?, NULL, ?)",
  )
    .bind(crypto.randomUUID(), text, createdAt)
    .run()
}

const authored = (agentId: string) =>
  JSON.stringify({ kind: "authored", author: { kind: "agent", agentId } })
const foundBy = (agentId: string) =>
  JSON.stringify({ kind: "found", finder: { kind: "agent", agentId } })

describe("app/db/pulse.ts - getPulse", () => {
  it("returns [] when nothing has happened", async () => {
    expect(await getPulse(env, NOW)).toEqual([])
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

    expect(await getPulse(env, NOW)).toEqual([
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

    const events = await getPulse(env, NOW)
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
    expect(await getPulse(env, NOW)).toEqual([])
  })

  // The Birth Rite (slopspot-growing-cast-7ni.3): a Proprietor 'birth' utterance surfaces as a POST-LESS
  // 'born' event carrying the welcome line verbatim — the names were baked at utter time, so the Pulse
  // needs no read-time persona resolution. It merges into the one stream and sorts by ts among posts/votes.
  it("surfaces a birth utterance as a post-less 'born' event, sorted into the stream by ts", async () => {
    await seedPersona("agent:maker", "Hieronymus")
    await seedPost({ id: "p_old", createdAt: 500, contentKind: "generation", originJson: authored("agent:maker") })
    const welcome = 'The Proprietor welcomes Idris Vane to the city. "The room remembers." — another devout pair of hands.'
    await seedBirthUtterance(welcome, 8000)

    expect(await getPulse(env, NOW)).toEqual([
      { kind: "born", ts: 8000, text: welcome },
      { kind: "posted", ts: 500, persona: "Hieronymus", postId: "p_old", title: "a piece" },
    ])
  })

  // The feast day: a venerated saint whose canonisation DOM recurs today returns to the Pulse
  // as a post-linked 'feast' event in the presiding citizen's name, stamped with the loader's
  // nowMs (so it heads the stream). A rogue crown (villain) gets notoriety, never a feast.
  // agent:slop-purist (St. Vivian, handle st-vivian) is seeded by migration 0017 — feastsToday
  // resolves the presiding name from that row, so the test seeds only the posts and the crowns.
  it("surfaces a venerated saint whose canonisation anniversary falls today, excluding rogues", async () => {
    await seedPost({ id: "p_saint", createdAt: 100, contentKind: "generation", originJson: authored("agent:slop-purist") })
    await seedPost({ id: "p_villain", createdAt: 100, contentKind: "generation", originJson: authored("agent:slop-purist") })
    // Both canonised on a prior month's 15th → feast today (Jan 15); distinct rite_days (one
    // crown per day). The villain shares the DOM but is a rogue, so it is never a feast.
    await seedCrown({ id: "c_saint", postId: "p_saint", riteDay: "2025-11-15", lens: "saint", presiding: "agent:slop-purist" })
    await seedCrown({ id: "c_villain", postId: "p_villain", riteDay: "2025-12-15", lens: "villain", presiding: "agent:slop-purist" })

    const feasts = (await getPulse(env, NOW)).filter((e) => e.kind === "feast")
    expect(feasts).toEqual([
      { kind: "feast", ts: NOW, persona: "St. Vivian", postId: "p_saint", lens: "saint", riteDay: "2025-11-15" },
    ])
  })

  // A saint whose canonisation DOM is not today's keeps its peace — no feast, no chrome.
  it("does not surface a feast on a non-anniversary day", async () => {
    await seedPost({ id: "p_saint", createdAt: 100, contentKind: "generation", originJson: authored("agent:slop-purist") })
    await seedCrown({ id: "c_saint", postId: "p_saint", riteDay: "2025-11-09", lens: "saint", presiding: "agent:slop-purist" })

    expect((await getPulse(env, NOW)).filter((e) => e.kind === "feast")).toEqual([])
  })
})
