import { useState } from "react"
import type { Post, Media, Origin, Actor, Content, GenerationStatus, VoteValue } from "~/lib/domain"

export function PostCard({
  post,
  score,
  myVote,
}: {
  post: Post
  score: number
  myVote: VoteValue | null
}) {
  return (
    <article className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
      <ContentView content={post.content} />
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
        <VoteControls postId={post.id} initialScore={score} initialMyVote={myVote} />
        <OriginBadge origin={post.origin} />
        {post.content.kind === "generation" && (
          <>
            <ProviderBadge providerId={post.content.recipe.providerId} />
            <StatusBadge status={post.content.status} />
          </>
        )}
        <span className="ml-auto font-mono text-white/40">{relativeTime(post.createdAt)}</span>
      </div>
      {post.content.kind === "generation" && (
        <details className="border-t border-white/10 px-3 py-2 text-[11px] text-white/55">
          <summary className="cursor-pointer select-none font-mono uppercase tracking-wider text-white/40">recipe</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-white/70">
{JSON.stringify(post.content.recipe.params, null, 2)}
          </pre>
        </details>
      )}
    </article>
  )
}

// [LAW:dataflow-not-control-flow] One submit path. Clicking ▲ or ▼ computes the
// next (score, myVote) from the discriminator (+1 / -1) and the current myVote,
// applies it optimistically, posts to the server, and either confirms or rolls
// back from the same code. The "skip if already-voted" case is data: when the
// click's value equals current myVote, the swing is zero and the request is
// trivially idempotent — we still send it (the server treats it as a no-op
// upsert), keeping the path uniform rather than branching on a "no-op" guard.
//
// [LAW:single-enforcer] The fetch shape is documented at the route boundary
// (POST /api/posts/:id/vote, body { value: 1 | -1 | 0 }, returns { score,
// value }). This component is the sole consumer; the server is the source of
// truth on the confirmed score after the write.
function VoteControls({
  postId,
  initialScore,
  initialMyVote,
}: {
  postId: string
  initialScore: number
  initialMyVote: VoteValue | null
}) {
  const [score, setScore] = useState(initialScore)
  const [myVote, setMyVote] = useState<VoteValue | null>(initialMyVote)
  const [pending, setPending] = useState(false)

  async function castVote(direction: VoteValue) {
    const prev = { score, myVote }
    const oldValue = myVote ?? 0
    // Optimistic: the local score moves by (newVote - oldVote). When direction
    // matches current myVote, the swing is zero — UI unchanged, idempotent
    // request still flies for symmetry.
    setScore(score + (direction - oldValue))
    setMyVote(direction)
    setPending(true)
    try {
      const res = await fetch(`/api/posts/${postId}/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: direction }),
      })
      if (!res.ok) throw new Error(`vote failed: ${res.status}`)
      const confirmed = (await res.json()) as { score: number; value: VoteValue | null }
      setScore(confirmed.score)
      setMyVote(confirmed.value)
    } catch {
      setScore(prev.score)
      setMyVote(prev.myVote)
    } finally {
      setPending(false)
    }
  }

  const upTone = myVote === 1
    ? "bg-emerald-400/20 text-emerald-300"
    : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80"
  const downTone = myVote === -1
    ? "bg-rose-400/20 text-rose-300"
    : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80"

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-label="upvote"
        aria-pressed={myVote === 1}
        disabled={pending}
        onClick={() => castVote(1)}
        className={`rounded px-1.5 py-0.5 font-mono transition disabled:opacity-50 ${upTone}`}
      >
        ▲
      </button>
      <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 font-mono text-emerald-300/90">
        {score}
      </span>
      <button
        type="button"
        aria-label="downvote"
        aria-pressed={myVote === -1}
        disabled={pending}
        onClick={() => castVote(-1)}
        className={`rounded px-1.5 py-0.5 font-mono transition disabled:opacity-50 ${downTone}`}
      >
        ▼
      </button>
    </span>
  )
}

// [LAW:types-are-the-program] Closed union → exhaustive switch. Adding a new
// GenerationStatus variant will fail to compile here until handled. The function's
// return type is the enforcement mechanism — no `default:` needed, and none wanted.
function ContentView({ content }: { content: Content }) {
  if (content.kind === "upload") return <MediaView media={content.asset} />
  const status = content.status
  switch (status.kind) {
    case "pending":   return <StatusPlaceholder tone="queued"  label="queued" />
    case "running":   return <StatusPlaceholder tone="working" label="generating…" />
    case "succeeded": return <MediaView media={status.output} />
    case "failed":    return <StatusPlaceholder tone="error"   label={`failed: ${status.reason}`} />
  }
}

function MediaView({ media }: { media: Media }) {
  switch (media.kind) {
    case "image":
      return (
        <img
          src={media.url}
          alt={media.alt ?? ""}
          width={media.w}
          height={media.h}
          loading="lazy"
          className="block h-auto w-full bg-white/5"
        />
      )
    case "video":
      return <video src={media.url} controls className="block w-full bg-black" />
    case "audio":
      return (
        <div className="px-3 py-4">
          <audio src={media.url} controls className="block w-full" />
        </div>
      )
    case "text":
      return (
        <div className="whitespace-pre-wrap px-4 py-6 text-base leading-relaxed text-white/90">
          {media.body}
        </div>
      )
  }
}

function StatusPlaceholder({ tone, label }: { tone: "queued" | "working" | "error"; label: string }) {
  const toneClass =
    tone === "queued"  ? "bg-white/5 text-white/50" :
    tone === "working" ? "bg-sky-400/10 text-sky-300/90 animate-pulse" :
                         "bg-rose-400/10 text-rose-300/90"
  return (
    <div className={`flex aspect-video items-center justify-center font-mono text-xs uppercase tracking-[0.2em] ${toneClass}`}>
      {label}
    </div>
  )
}

function actorLabel(a: Actor): { label: string; tone: string } {
  if (a.kind === "user") return { label: `@${a.userId}`, tone: "text-sky-300/90 bg-sky-400/10" }
  if (a.agentId.startsWith("sys:")) return { label: a.agentId, tone: "text-amber-300/90 bg-amber-400/10" }
  return { label: a.agentId, tone: "text-fuchsia-300/90 bg-fuchsia-400/10" }
}

function OriginBadge({ origin }: { origin: Origin }) {
  const a = actorLabel(origin.actor)
  if (!origin.onBehalfOf) {
    return <span className={`rounded px-1.5 py-0.5 font-mono ${a.tone}`}>{a.label}</span>
  }
  const b = actorLabel(origin.onBehalfOf)
  return (
    <span className="inline-flex items-center gap-1 font-mono">
      <span className={`rounded px-1.5 py-0.5 ${a.tone}`}>{a.label}</span>
      <span className="text-white/40">for</span>
      <span className={`rounded px-1.5 py-0.5 ${b.tone}`}>{b.label}</span>
    </span>
  )
}

function ProviderBadge({ providerId }: { providerId: string }) {
  return (
    <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-white/60">
      {providerId}
    </span>
  )
}

function StatusBadge({ status }: { status: GenerationStatus }) {
  if (status.kind === "succeeded") return null
  const tone =
    status.kind === "pending" ? "bg-white/5 text-white/50" :
    status.kind === "running" ? "bg-sky-400/10 text-sky-300/90" :
                                "bg-rose-400/10 text-rose-300/90"
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono ${tone}`}>{status.kind}</span>
  )
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime()
  const m = Math.round(diff / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const days = Math.round(h / 24)
  return `${days}d`
}
