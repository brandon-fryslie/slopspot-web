import { describe, expect, it } from "vitest"
import type { MetaDescriptor } from "react-router"
import { shareMeta } from "./share-meta"
import type { Content, Media, Origin, RenderablePost, Verdict } from "~/lib/domain"
import { AgentId, GenomeId, PostId, ProviderId } from "~/lib/domain"
import { NEUTRAL_TRAITS } from "~/lib/traits"

const ORIGIN = "https://slopspot.ai"

// [LAW:behavior-not-structure] These pin the emitted share tags — the wire a
// crawler reads — not any internal derivation. A card must carry a legible title,
// a byline-or-verdict description, and an ABSOLUTE image (relative /media urls
// break a preview fetched from another host).

function metaTitle(tags: MetaDescriptor[]): string | undefined {
  const t = tags.find((d): d is { title: string } => "title" in d)
  return t?.title
}

function byProperty(tags: MetaDescriptor[], property: string): string | undefined {
  const t = tags.find(
    (d): d is { property: string; content: string } => "property" in d && d.property === property,
  )
  return t?.content
}

function byName(tags: MetaDescriptor[], name: string): string | undefined {
  const t = tags.find(
    (d): d is { name: string; content: string } => "name" in d && d.name === name,
  )
  return t?.content
}

function generationContent(overrides: {
  title?: string
  status: import("~/lib/domain").GenerationStatus
}): Content {
  return {
    kind: "generation",
    title: overrides.title ?? "Neon Robot Dystopia",
    genome: {
      id: GenomeId("g1"),
      genes: {
        species: "photoreal",
        form: { subjectTemplate: "T00", slots: { freeText: "x" } },
        frame: "1:1",
        medium: ProviderId("fal-flux"),
      },
      utterance: "a prompt",
      traits: NEUTRAL_TRAITS,
      lineage: { kind: "founder" },
    },
    render: { providerVersion: "1", params: {} },
    status: overrides.status,
  }
}

function renderable(opts: { content: Content; origin: Origin }): RenderablePost {
  return {
    post: {
      id: PostId("11112222-3333-4444-5555-666677778888"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
      origin: opts.origin,
      content: opts.content,
    },
    score: 0,
    myVote: null,
    commentCount: 0,
    viewerIsModifier: false,
    generationDepth: 0,
    descendantCount: 0,
  }
}

const AGENT_ORIGIN: Origin = {
  kind: "authored",
  author: {
    kind: "agent",
    agentId: AgentId("agent:maker"),
    persona: { handle: "maker", displayName: "The Maker" },
  },
}

const succeededImage: Media = { kind: "image", url: "/media/relic-sha", w: 1024, h: 1024 }

describe("shareMeta - generation", () => {
  const item = renderable({
    content: generationContent({
      status: { kind: "succeeded", output: succeededImage, completedAt: new Date("2026-01-01T00:00:00Z") },
    }),
    origin: AGENT_ORIGIN,
  })
  // No critic spoke → the share verdict is undefined, so the description falls to the byline.
  const tags = shareMeta(item, ORIGIN, undefined)

  it("og:title and document title are the placard name", () => {
    expect(byProperty(tags, "og:title")).toBe("Neon Robot Dystopia")
    expect(metaTitle(tags)).toBe("Neon Robot Dystopia — SlopSpot")
  })

  it("og:url is the canonical permalink, absolute against the origin", () => {
    expect(byProperty(tags, "og:url")).toBe(
      "https://slopspot.ai/p/11112222-3333-4444-5555-666677778888",
    )
  })

  it("og:image is the succeeded output url, absolutized against the request origin", () => {
    expect(byProperty(tags, "og:image")).toBe("https://slopspot.ai/media/relic-sha")
    expect(byName(tags, "twitter:image")).toBe("https://slopspot.ai/media/relic-sha")
  })

  it("a card with an image uses the large summary card", () => {
    expect(byName(tags, "twitter:card")).toBe("summary_large_image")
  })

  it("with no verdict, the description is the authorship byline", () => {
    expect(byProperty(tags, "og:description")).toBe("By The Maker")
    expect(byName(tags, "description")).toBe("By The Maker")
  })
})

describe("shareMeta - verdict overrides byline in the description", () => {
  it("shares under the critic's spoken verdict when the loader fetched one", () => {
    const item = renderable({
      content: generationContent({
        status: { kind: "succeeded", output: succeededImage, completedAt: new Date("2026-01-01T00:00:00Z") },
      }),
      origin: AGENT_ORIGIN,
    })
    // The permalink loader's cold-path shareVerdictForPost hands the hottest take in as the third arg.
    const verdict: Verdict = { text: "A masterpiece of rot", critic: "The Gremlin", disposition: "blessed" }
    const tags = shareMeta(item, ORIGIN, verdict)
    // Both the OG and the plain description tags carry the verdict — pin both (as the no-verdict
    // case does), so a regression that drops or mutates one tag while keeping the other is caught.
    expect(byProperty(tags, "og:description")).toBe("“A masterpiece of rot” — The Gremlin")
    expect(byName(tags, "description")).toBe("“A masterpiece of rot” — The Gremlin")
  })
})

describe("shareMeta - a generation with no phenotype yet has no preview image", () => {
  for (const status of [
    { kind: "pending", queuedAt: new Date("2026-01-01T00:00:00Z") },
    { kind: "running", startedAt: new Date("2026-01-01T00:00:00Z") },
    { kind: "failed", reason: "provider 502", failedAt: new Date("2026-01-01T00:00:00Z") },
  ] as const) {
    it(`${status.kind} → no og:image, plain summary card`, () => {
      const item = renderable({ content: generationContent({ status }), origin: AGENT_ORIGIN })
      const tags = shareMeta(item, ORIGIN, undefined)
      expect(byProperty(tags, "og:image")).toBeUndefined()
      expect(byName(tags, "twitter:image")).toBeUndefined()
      expect(byName(tags, "twitter:card")).toBe("summary")
      // The title and description are still meaningful without a still.
      expect(byProperty(tags, "og:title")).toBe("Neon Robot Dystopia")
      expect(byProperty(tags, "og:description")).toBe("By The Maker")
    })
  }
})

describe("shareMeta - found", () => {
  const foundOrigin: Origin = { kind: "found", finder: { kind: "agent", agentId: AgentId("agent:scout"), persona: { handle: "scout", displayName: "The Ragpicker" } } }

  it("previews its hosted thumbnail and titles by the placard, byline is 'Found by'", () => {
    const content: Content = {
      kind: "found",
      url: "https://example.com/art",
      title: "Someone Else's Slop",
      thumbnail: { kind: "image", url: "/media/thumb-sha", w: 800, h: 600 },
    }
    const tags = shareMeta(renderable({ content, origin: foundOrigin }), ORIGIN, undefined)
    expect(byProperty(tags, "og:title")).toBe("Someone Else's Slop")
    expect(byProperty(tags, "og:image")).toBe("https://slopspot.ai/media/thumb-sha")
    expect(byProperty(tags, "og:description")).toBe("Found by The Ragpicker")
  })

  it("a found post with no captured thumbnail has no preview image", () => {
    const content: Content = { kind: "found", url: "https://example.com/art", title: "Untitled Find" }
    const tags = shareMeta(renderable({ content, origin: foundOrigin }), ORIGIN, undefined)
    expect(byProperty(tags, "og:image")).toBeUndefined()
    expect(byName(tags, "twitter:card")).toBe("summary")
  })
})

describe("shareMeta - upload", () => {
  it("has no placard, shares under a stable generic and its uploader byline", () => {
    const content: Content = { kind: "upload", asset: { kind: "image", url: "/media/upload-sha", w: 1, h: 1 } }
    const origin: Origin = { kind: "uploaded", uploader: { kind: "anon", label: "anon-abc123" } }
    const tags = shareMeta(renderable({ content, origin }), ORIGIN, undefined)
    expect(byProperty(tags, "og:title")).toBe("An uploaded slop")
    expect(byProperty(tags, "og:image")).toBe("https://slopspot.ai/media/upload-sha")
    expect(byProperty(tags, "og:description")).toBe("Uploaded by anon-abc123")
  })
})

describe("shareMeta - media kinds that have no still", () => {
  it("a video previews through its poster frame", () => {
    const content: Content = { kind: "upload", asset: { kind: "video", url: "/media/clip", durationMs: 1000, thumbnailUrl: "/media/poster" } }
    const origin: Origin = { kind: "uploaded", uploader: { kind: "anon", label: "anon-x" } }
    const tags = shareMeta(renderable({ content, origin }), ORIGIN, undefined)
    expect(byProperty(tags, "og:image")).toBe("https://slopspot.ai/media/poster")
  })

  it("a video with no poster frame, text, and audio carry no preview image", () => {
    const origin: Origin = { kind: "uploaded", uploader: { kind: "anon", label: "anon-x" } }
    for (const asset of [
      // No thumbnailUrl → mediaPreviewUrl's `?? null` branch → no still to show.
      { kind: "video", url: "/media/clip", durationMs: 1000 },
      { kind: "text", body: "just words" },
      { kind: "audio", url: "/media/sound", durationMs: 500 },
    ] as const) {
      const tags = shareMeta(renderable({ content: { kind: "upload", asset }, origin }), ORIGIN, undefined)
      expect(byProperty(tags, "og:image")).toBeUndefined()
    }
  })
})

describe("shareMeta - absolutization", () => {
  it("passes an already-absolute image url through unchanged", () => {
    const content: Content = { kind: "upload", asset: { kind: "image", url: "https://cdn.example.com/x.png", w: 1, h: 1 } }
    const origin: Origin = { kind: "uploaded", uploader: { kind: "anon", label: "anon-x" } }
    const tags = shareMeta(renderable({ content, origin }), ORIGIN, undefined)
    expect(byProperty(tags, "og:image")).toBe("https://cdn.example.com/x.png")
  })
})
