// [LAW:behavior-not-structure] Pins getChorus's contract - which citizen voices it surfaces for the
// homepage masthead, in what order - against a real D1 isolate. The chorus is the page's voice routed
// through the WHOLE ROSTER, so the test pins exactly the properties the CD's "different beings" bar needs:
// distinct speakers (breadth, never one narrator repeated), recency order (who's awake/at-work now), the
// named-only / spoke-only / birth-excluded filters, and the honest-empty floor (zero rows → [], the
// caller's Proprietor floor speaks only then).

import { describe, expect, it } from "vitest"
import { env } from "cloudflare:test"
import { db } from "~/db/client"
import { getChorus } from "~/db/chorus"

async function seedPersona(agentId: string, displayName: string) {
  await env.DB.prepare(
    "INSERT INTO personas (agent_id, handle, display_name, role, persona_prompt, model_id, config_json, created_at) VALUES (?, NULL, ?, 'generator', 'p', 'm', '{}', 1)",
  )
    .bind(agentId, displayName)
    .run()
}

async function seedPost(id: string) {
  await env.DB.prepare(
    "INSERT INTO posts (id, created_at, content_kind, origin_json) VALUES (?, 1, 'generation', '{}')",
  )
    .bind(id)
    .run()
}

async function seedUtterance(opts: {
  speaker: string
  targetPostId: string | null
  occasion?: string
  kind?: "spoke" | "withheld"
  text?: string | null
  withheldReason?: string | null
  createdAt: number
}) {
  const kind = opts.kind ?? "spoke"
  await env.DB.prepare(
    "INSERT INTO utterances (id, speaker, occasion, target_post_id, kind, text, withheld_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      opts.speaker,
      opts.occasion ?? "verdict",
      opts.targetPostId,
      kind,
      kind === "spoke" ? (opts.text ?? "a line") : null,
      kind === "withheld" ? (opts.withheldReason ?? "indifferent") : null,
      opts.createdAt,
    )
    .run()
}

describe("getChorus", () => {
  it("returns [] when no citizen has spoken - the Proprietor floor's job, not a fabricated line", async () => {
    expect(await getChorus(db(env))).toEqual([])
  })

  it("surfaces named citizens' spoken lines, most-recently-active first", async () => {
    await seedPersona("a:gutter", "GutterMonk")
    await seedPersona("a:vesper", "Vesper")
    await seedPost("p1")
    await seedPost("p2")
    await seedUtterance({ speaker: "a:gutter", targetPostId: "p1", text: "flat and devastated", createdAt: 100 })
    await seedUtterance({ speaker: "a:vesper", targetPostId: "p2", text: "effusive and gilded", createdAt: 200 })

    const chorus = await getChorus(db(env))
    expect(chorus.map((l) => l.displayName)).toEqual(["Vesper", "GutterMonk"])
    expect(chorus[0]).toMatchObject({ displayName: "Vesper", text: "effusive and gilded", postId: "p2" })
  })

  it("collapses a chatty citizen to ONE latest line - breadth, never one voice repeated", async () => {
    await seedPersona("a:idris", "Idris")
    await seedPost("p1")
    await seedPost("p2")
    await seedUtterance({ speaker: "a:idris", targetPostId: "p1", text: "old deadpan", createdAt: 100 })
    await seedUtterance({ speaker: "a:idris", targetPostId: "p2", text: "new deadpan", createdAt: 300 })

    const chorus = await getChorus(db(env))
    expect(chorus).toHaveLength(1)
    expect(chorus[0]).toMatchObject({ displayName: "Idris", text: "new deadpan" })
  })

  it("respects the cap - bounds the slot, the read's length is the data", async () => {
    for (const [id, name] of [["a", "A"], ["b", "B"], ["c", "C"]] as const) {
      await seedPersona(`a:${id}`, name)
      await seedPost(`p${id}`)
      await seedUtterance({ speaker: `a:${id}`, targetPostId: `p${id}`, text: `${name} speaks`, createdAt: id.charCodeAt(0) })
    }
    expect(await getChorus(db(env), 2)).toHaveLength(2)
  })

  it("surfaces a noticing — a critic's remark on a monoculture rides the masthead like a verdict", async () => {
    // slopspot-genome-brs: the city NOTICING a convergence is a chorus-eligible voice (verdict/reply/grace/
    // noticing), so adding it to CHORUS_OCCASIONS surfaces it with zero new read path.
    await seedPersona("a:idris", "Idris")
    await seedPost("p1")
    await seedUtterance({
      speaker: "a:idris",
      targetPostId: "p1",
      occasion: "noticing",
      text: "Another fox. The well keeps dreaming the same dream.",
      createdAt: 400,
    })

    const chorus = await getChorus(db(env))
    expect(chorus).toEqual([
      { speaker: "a:idris", displayName: "Idris", text: "Another fox. The well keeps dreaming the same dream.", postId: "p1" },
    ])
  })

  it("excludes unnamed speakers, withheld silences, and the Proprietor's birth lines (one narrator)", async () => {
    await seedPersona("a:named", "Named")
    await seedPersona("a:blank", "") // a persona with no byline - excluded
    await seedPost("p1")
    await seedPost("p2")
    await seedPost("p3")
    await seedPost("p4")
    await seedUtterance({ speaker: "a:named", targetPostId: "p1", text: "a real verdict", createdAt: 500 })
    // an unseeded speaker (no persona row) - no byline, falls out by the INNER JOIN
    await seedUtterance({ speaker: "a:ghost", targetPostId: "p2", text: "ghost line", createdAt: 600 })
    // a blank-name persona - excluded by the named filter
    await seedUtterance({ speaker: "a:blank", targetPostId: "p3", text: "blank byline", createdAt: 700 })
    // a withheld silence - recorded, but renders nothing, so not in the chorus
    await seedUtterance({ speaker: "a:named", targetPostId: "p4", kind: "withheld", createdAt: 800 })
    // a birth line is always the Proprietor's one voice - excluded so it can't flatten the breadth
    await seedUtterance({ speaker: "a:named", targetPostId: "p4", occasion: "birth", text: "welcome", createdAt: 900 })

    const chorus = await getChorus(db(env))
    expect(chorus).toEqual([
      { speaker: "a:named", displayName: "Named", text: "a real verdict", postId: "p1" },
    ])
  })
})
