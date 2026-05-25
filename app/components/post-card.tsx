import { useEffect, useRef, useState } from "react"
import type { Post, Media, Origin, Actor, Content, GenerationStatus, VoteValue } from "~/lib/domain"

export function PostCard({
  post,
  score,
  myVote,
  commentCount,
}: {
  post: Post
  score: number
  myVote: VoteValue | null
  commentCount: number
}) {
  return (
    <article className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]">
      <ContentView content={post.content} />
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
        <VoteControls postId={post.id} initialScore={score} initialMyVote={myVote} />
        <OriginBadge origin={post.origin} />
        {/* [LAW:types-are-the-program] Fork button gated on the content
            discriminator at compile time — uploads carry no recipe and
            therefore cannot be forked, by construction. No runtime check,
            no fallback branch. */}
        {post.content.kind === "generation" && (
          <>
            <ForkLink postId={post.id} />
            <ProviderBadge providerId={post.content.recipe.providerId} />
            <StatusBadge status={post.content.status} />
            {/* [LAW:types-are-the-program] parentId is optional in the recipe;
                a present value means this post is itself a fork. Lineage is
                opt-in by data — the badge renders or not, no flag needed. */}
            {post.content.recipe.parentId !== undefined && (
              <ForkedFromBadge parentId={post.content.recipe.parentId} />
            )}
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
      <CommentSection postId={post.id} initialCount={commentCount} />
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
  // [LAW:single-enforcer] Synchronous re-entrancy guard. `setPending(true)` is
  // queued for the next render, so a rapid second click inside the same
  // microtask would still see `pending === false` from React state. The ref is
  // mutated synchronously, so the second click bails on the same tick. The
  // button's `disabled={pending}` is the visual signal; this ref is the
  // correctness guarantee.
  const inFlight = useRef(false)

  // [LAW:one-source-of-truth] The server (via the loader's props) is the truth;
  // local state is a cache with an optimistic overlay. On a parent re-render
  // with new initial values (loader revalidation, navigation back, HMR), pull
  // the truth back into the cache — except while a vote is in flight, where
  // doing so would yank the optimistic overlay out from under the user.
  useEffect(() => {
    if (!inFlight.current) {
      setScore(initialScore)
      setMyVote(initialMyVote)
    }
  }, [initialScore, initialMyVote])

  async function castVote(direction: VoteValue) {
    if (inFlight.current) return
    inFlight.current = true

    const prev = { score, myVote }
    const oldValue = myVote ?? 0
    // Optimistic: the local score moves by (newVote - oldVote). When direction
    // matches current myVote, the swing is zero — UI unchanged, idempotent
    // request still flies for symmetry. Stale-closure arithmetic isn't a
    // concern because the inFlight guard prevents a second castVote until this
    // one has both confirmed/rolled-back and cleared the flag.
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
      inFlight.current = false
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

// [LAW:types-are-the-program] Exhaustive switch on Actor.kind. Adding a new
// variant to the Actor union will fail to compile here until handled.
function actorLabel(a: Actor): { label: string; tone: string } {
  switch (a.kind) {
    case "user":  return { label: `@${a.userId}`, tone: "text-sky-300/90 bg-sky-400/10" }
    case "agent": return { label: a.agentId,      tone: "text-amber-300/90 bg-amber-400/10" }
    case "anon":  return { label: a.label,         tone: "text-fuchsia-300/90 bg-fuchsia-400/10" }
  }
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

// [LAW:single-enforcer] The Fork link only exists in PostCard. The button-vs-
// link choice is deliberate: forking navigates to a form page (recipe editing
// is not a one-click action), so an <a> with a meaningful href is the right
// affordance — middle-click opens the form in a new tab, no JS needed for
// discoverability.
function ForkLink({ postId }: { postId: string }) {
  return (
    <a
      href={`/fork/${postId}`}
      className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-white/60 transition hover:bg-emerald-400/15 hover:text-emerald-300"
    >
      fork
    </a>
  )
}

// [LAW:dataflow-not-control-flow] The lineage badge is a pure function of
// recipe.parentId — it renders when the data says so. No "is this a fork"
// flag, no parallel boolean; the optional id is the discriminator.
function ForkedFromBadge({ parentId }: { parentId: string }) {
  return (
    <span
      className="rounded bg-fuchsia-400/10 px-1.5 py-0.5 font-mono text-fuchsia-300/90"
      title={`forked from ${parentId}`}
    >
      forked from p:{parentId.slice(0, 8)}
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

// [LAW:types-are-the-program] Wire shape for a comment as it arrives from the
// /api/posts/:id/comments loader. createdAt is an ISO string on the wire; the
// component parses it to Date once at the JSON boundary. authorLabel is the
// already-redacted display string (server-side single-enforcer in
// app/lib/author-label) — the raw voter UUID never crosses this boundary, so
// the client cannot leak it back into the page even by accident.
type ClientComment = {
  id: string
  authorLabel: string
  body: string
  createdAt: string
}

// [LAW:types-are-the-program] The thread's state is a closed discriminated
// union. "Cached list but currently hidden" is `ready { expanded: false }`,
// distinct from "never loaded" (`unloaded`). One discriminator carries every
// legal state; no parallel booleans for `loading` / `hasData` / `expanded` that
// could fall into illegal combinations.
type ThreadState =
  | { kind: "unloaded" }
  | { kind: "loading" }
  | { kind: "error"; reason: string }
  | { kind: "ready"; expanded: boolean; comments: ClientComment[] }

function CommentSection({
  postId,
  initialCount,
}: {
  postId: string
  initialCount: number
}) {
  const [thread, setThread] = useState<ThreadState>({ kind: "unloaded" })
  // localCount lives outside the thread discriminator because every arm (even
  // unloaded) shows the count in the collapsed header. Bumped on successful
  // post so the user sees their own comment counted without a refetch.
  const [localCount, setLocalCount] = useState(initialCount)
  const [composeBody, setComposeBody] = useState("")
  const [submitting, setSubmitting] = useState(false)
  // [LAW:single-enforcer] Synchronous re-entrancy guard, same shape as the
  // vote endpoint's inFlight ref. Rapid double-submit inside one microtask
  // would see the same stale `submitting === false` from React state.
  const inFlight = useRef(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // [LAW:one-source-of-truth] Loader is the truth on initial count; pull back
  // in on revalidation, mirroring VoteControls' useEffect. Skipped while a
  // submit is in flight so the optimistic bump isn't yanked out.
  useEffect(() => {
    if (!inFlight.current) setLocalCount(initialCount)
  }, [initialCount])

  async function loadThread() {
    setThread({ kind: "loading" })
    try {
      const res = await fetch(`/api/posts/${postId}/comments`)
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = (await res.json()) as { comments: ClientComment[] }
      setThread({ kind: "ready", expanded: true, comments: data.comments })
    } catch (err) {
      setThread({ kind: "error", reason: String(err) })
    }
  }

  // [LAW:dataflow-not-control-flow] Toggle is one path. The discriminator on
  // `thread.kind` selects which transition fires: an unloaded thread fetches;
  // a loaded thread flips `expanded`; an error retries. No bag-of-flags that
  // could combine into illegal states (loading-but-collapsed, etc.).
  function onToggle() {
    if (thread.kind === "unloaded") {
      void loadThread()
      return
    }
    if (thread.kind === "ready") {
      setThread({ ...thread, expanded: !thread.expanded })
      return
    }
    if (thread.kind === "error") {
      void loadThread()
      return
    }
    // loading: ignore additional clicks until the fetch resolves
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (inFlight.current) return
    const body = composeBody.trim()
    if (body.length === 0) {
      setSubmitError("comment cannot be empty")
      return
    }
    if (body.length > 2000) {
      setSubmitError("comment must be 2000 characters or fewer")
      return
    }
    inFlight.current = true
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => "")
        throw new Error(`comment failed: ${res.status} ${detail}`.trim())
      }
      const created = (await res.json()) as ClientComment
      // Prepend the server-confirmed comment to the cached list (newest-first
      // is the canonical thread order — matches listComments' orderBy).
      setThread((prev) =>
        prev.kind === "ready"
          ? { ...prev, comments: [created, ...prev.comments] }
          : { kind: "ready", expanded: true, comments: [created] },
      )
      setLocalCount((n) => n + 1)
      setComposeBody("")
    } catch (err) {
      setSubmitError(String(err))
    } finally {
      setSubmitting(false)
      inFlight.current = false
    }
  }

  const isExpanded = thread.kind === "ready" && thread.expanded
  const isLoading = thread.kind === "loading"

  return (
    <section className="border-t border-white/10">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between px-3 py-2 text-left font-mono text-xs text-white/55 transition hover:bg-white/[0.03] hover:text-white/80"
      >
        <span>
          {localCount === 0
            ? "no comments yet"
            : localCount === 1
            ? "1 comment"
            : `${localCount} comments`}
        </span>
        <span aria-hidden className="font-mono text-white/30">
          {isLoading ? "…" : isExpanded ? "▾" : "▸"}
        </span>
      </button>

      {thread.kind === "error" && (
        <div className="border-t border-white/10 px-3 py-3 font-mono text-[11px] text-rose-300/90">
          failed to load: {thread.reason} — click to retry
        </div>
      )}

      {isExpanded && thread.kind === "ready" && (
        <div className="border-t border-white/10">
          <ul className="flex flex-col divide-y divide-white/5">
            {thread.comments.length === 0 ? (
              <li className="px-3 py-4 font-mono text-[11px] text-white/40">
                be the first to slop on this slop
              </li>
            ) : (
              thread.comments.map((c) => <CommentRow key={c.id} comment={c} />)
            )}
          </ul>
          <form onSubmit={onSubmit} className="border-t border-white/10 px-3 py-3">
            <textarea
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              placeholder="leave a comment…"
              maxLength={2000}
              rows={2}
              disabled={submitting}
              className="block w-full resize-y rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-xs text-white/85 placeholder:text-white/30 focus:border-emerald-400/60 focus:outline-none disabled:opacity-50"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="font-mono text-[10px] text-white/35">
                {composeBody.trim().length}/2000
              </span>
              <button
                type="submit"
                disabled={submitting || composeBody.trim().length === 0}
                className="rounded bg-emerald-400/20 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-400/30 disabled:opacity-40"
              >
                {submitting ? "posting…" : "post"}
              </button>
            </div>
            {submitError !== null && (
              <p className="mt-2 font-mono text-[11px] text-rose-300/90">{submitError}</p>
            )}
          </form>
        </div>
      )}
    </section>
  )
}

function CommentRow({ comment }: { comment: ClientComment }) {
  return (
    <li className="px-3 py-2">
      <div className="flex items-center gap-2 font-mono text-[10px] text-white/45">
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-white/65">{comment.authorLabel}</span>
        <span>{relativeTime(new Date(comment.createdAt))}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/85">
        {comment.body}
      </p>
    </li>
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
