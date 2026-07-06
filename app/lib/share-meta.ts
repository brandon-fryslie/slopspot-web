import type { MetaDescriptor } from "react-router"
import type { Content, Media, Origin, RenderablePost } from "~/lib/domain"
import { actorName } from "~/lib/author-label"

// [LAW:decomposition] Share metadata is a PURE projection of a RenderablePost —
// the same object the detail page hangs, reduced to the three facts a link
// preview needs (a title, a description, a still image) plus the OG/Twitter tags
// that carry them. It lives apart from the route so it is unit-testable without
// an RR7 render harness, and the route's meta() is a two-line adapter over it.
//
// [LAW:effects-at-boundaries] This function is pure: the `origin` it needs to
// absolutize relative media urls is passed IN as a value. The loader — the one
// boundary holding the Request — extracts `new URL(request.url).origin` and hands
// it here; meta() has no access to the request host (RR7's MetaArgs carries only
// a client Location), so the origin must arrive as loader data.

// og:image wants a still to show in the card. An image is its own preview; a
// video previews through its poster frame; text and audio have no still to show.
// [LAW:dataflow-not-control-flow] the Media kind is the discriminator — absence
// (null) is a value the caller folds, never a skipped branch.
function mediaPreviewUrl(media: Media): string | null {
  switch (media.kind) {
    case "image":
      return media.url
    case "video":
      return media.thumbnailUrl ?? null
    case "text":
      return null
    case "audio":
      return null
  }
}

// The relic to preview, per content kind: a succeeded generation shows its
// output; an upload shows its bytes; a found post shows the thumbnail WE host
// (never hot-linking the source page's own image, which is not ours to embed).
// Null where no still exists yet — a generation still pending/failed, or a found
// post with no captured thumbnail. The status kind and thumbnail presence are the
// discriminators, not flags.
function previewUrl(content: Content): string | null {
  switch (content.kind) {
    case "generation":
      return content.status.kind === "succeeded"
        ? mediaPreviewUrl(content.status.output)
        : null
    case "upload":
      return mediaPreviewUrl(content.asset)
    case "found":
      return content.thumbnail !== undefined ? mediaPreviewUrl(content.thumbnail) : null
  }
}

// The share title is the piece's placard — the citizen's name for it. Uploads
// carry no placard (raw bytes, no title slot in the domain), so they share under
// a stable generic rather than an empty or serial-only headline.
function shareTitle(content: Content): string {
  switch (content.kind) {
    case "generation":
      return content.title
    case "found":
      return content.title
    case "upload":
      return "An uploaded slop"
  }
}

// The authorship line, plain-text, per genesis. Reuses the ONE actor-name rule so
// a card's byline can never disagree with the page's byline on who made the slop.
function bylineText(origin: Origin): string {
  switch (origin.kind) {
    case "authored":
      return `By ${actorName(origin.author)}`
    case "found":
      return `Found by ${actorName(origin.finder)}`
    case "uploaded":
      return `Uploaded by ${actorName(origin.uploader)}`
  }
}

// og:description is "byline/verdict": a critic's spoken opinion makes the sharpest
// card, so a slop that has been judged shares under its first verdict; one that
// has not falls back to the authorship line. [LAW:dataflow-not-control-flow] the
// verdicts array's emptiness is the discriminator (the same one the card renders
// by), not an isReviewed flag — both branches yield an equally valid description.
function shareDescription(item: RenderablePost): string {
  const [verdict] = item.verdicts
  if (verdict !== undefined) return `“${verdict.text}” — ${verdict.critic}`
  return bylineText(item.post.origin)
}

// Absolutize a media url against the request origin. Media urls are relative
// (`/media/<sha>`); a share crawler fetches og:image from another host, so it must
// be absolute. `new URL(url, origin)` resolves a relative path against the origin
// and passes an already-absolute url through unchanged.
function absolutize(url: string, origin: string): string {
  return new URL(url, origin).toString()
}

// [LAW:single-enforcer] The one place /p/:id's share tags are minted. Title,
// description and the still-image url are derived once; the OG/Twitter tag list is
// a pure function of those three values. The image tags exist iff there is a still
// to show — an og:image with no url is a broken card, so their presence IS the
// data (a spread of a possibly-empty list), never an imperative push.
export function shareMeta(item: RenderablePost, origin: string): MetaDescriptor[] {
  const title = shareTitle(item.post.content)
  const description = shareDescription(item)
  const preview = previewUrl(item.post.content)
  const imageUrl = preview !== null ? absolutize(preview, origin) : null

  const imageTags: MetaDescriptor[] =
    imageUrl !== null
      ? [
          { property: "og:image", content: imageUrl },
          { name: "twitter:image", content: imageUrl },
        ]
      : []

  return [
    { title: `${title} — SlopSpot` },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "article" },
    {
      name: "twitter:card",
      content: imageUrl !== null ? "summary_large_image" : "summary",
    },
    ...imageTags,
  ]
}
