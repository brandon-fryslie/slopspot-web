import { useEffect, useRef, useState } from "react"
import type { Media, Origin, Actor, Content, Crowning, CrownMark, Genome, GenerationRender, GenerationStatus, HumanRole, Lineage, PersonaActor, Post, PostId, RenderablePost, RiteLens, Verdict, VerdictDisposition, VoteValue } from "~/lib/domain"
import { utter, type AnsweredWish, type PersonaRef } from "~/lib/voice"
import { PROPRIETOR } from "~/lib/proprietor"
import { modifierSubject, wishGapCaption } from "~/lib/wish-copy"

// [LAW:types-are-the-program] How grandly a slop is FRAMED is a closed union, never a
// loose flag. Each container assigns the level — a feed by prominence, a permalink as a
// lone relic — and the card renders the frame by exhaustive match. The crowned treatment
// is categorically grander than the quiet levels so the masterpiece can command without
// a quiet tile creeping up toward it. Adding a level fails to compile until RelicFrame
// handles it.
export type FrameLevel = "crowned" | "study" | "standalone"

// [LAW:types-are-the-program] PostCard consumes a RenderablePost — the
// shape that the feed reader and the permalink reader both produce — plus the
// frame LEVEL its container assigns. The list-position `rank` field that lives
// on FeedItem is deliberately NOT in this prop type: PostCard renders the same
// way whether it appears in a ranked list or as a permalink, so it has no
// business reading rank. The frame level is the one presentation variable a
// container gets to set; everything else is the renderable itself.
export function PostCard({
  post,
  score,
  myVote,
  commentCount,
  viewerIsModifier,
  verdict,
  crowning,
  frame,
}: RenderablePost & { frame: FrameLevel }) {
  // [LAW:dataflow-not-control-flow] The wished-slop reveal is EMERGENT, not a mode:
  // a non-null WishContext is a property of the snapshot (a generation carrying the
  // human's verbatim wish, authored by a citizen). Its presence — never an isWished
  // flag — turns the wish-gap panel and signed remark on. Honest data in, honest
  // display out; this card reads the snapshot and triggers no act.
  const wish = wishContext(post)
  return (
    <article className="overflow-hidden rounded-lg border border-votive/12 bg-panel">
      <ContentView content={post.content} frame={frame} />
      {/* [LAW:dataflow-not-control-flow] The eternal mark renders by the PRESENCE of
          the Crowning the read boundary derived from the crowns table — never an
          isCrowned flag. An uncrowned post carries no crowning and this block does
          not appear; a crowned one wears its mark forever, here in the living feed. */}
      {crowning !== undefined && <EternalMark crowning={crowning} />}
      {/* [LAW:types-are-the-program] The placard renders for generation content by
          the discriminator — the title is a guaranteed-present field on that arm,
          so there is no nameless branch. The citizen's name for the PIECE, never the
          raw prompt. */}
      {post.content.kind === "generation" && (
        <h2 className="px-3 pt-3 font-placard text-2xl leading-tight text-bone">
          {post.content.title}
        </h2>
      )}
      {/* The inversion as typography: the citizen authors, billed big; the human is
          the occasion, a footnote. (See Byline.) */}
      <Byline origin={post.origin} viewerIsModifier={viewerIsModifier} />
      {/* [LAW:dataflow-not-control-flow] The wish-gap and the signed remark are the
          art: the human's words preserved verbatim beside the result that ignored
          them, and the answerer's in-character note about what she did. Shown, never
          hidden; explained by no modal. They render iff the snapshot is a wished one.
          The wish-gap caption is viewer-aware: second-person for the wisher, honest
          third-person for a stranger — selected by the viewerIsModifier value. */}
      {wish !== null && (
        <>
          <WishGap wish={wish.wish} viewerIsModifier={viewerIsModifier} />
          <SignedRemark ctx={wish} />
        </>
      )}
      {/* [LAW:dataflow-not-control-flow] The critic's verdict renders by the presence
          of the value the read boundary computed — a slop no critic has weighed in on
          carries no verdict and this block simply does not appear. No isReviewed flag,
          no empty placeholder museum-speak. */}
      {verdict !== undefined && <VerdictLine verdict={verdict} />}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
        <VoteControls postId={post.id} initialScore={score} initialMyVote={myVote} />
        {/* [LAW:types-are-the-program] Fork button gated on the content
            discriminator at compile time — uploads carry no recipe and
            therefore cannot be forked, by construction. No runtime check,
            no fallback branch. */}
        {post.content.kind === "generation" && (
          <>
            <ForkLink postId={post.id} />
            <StatusBadge status={post.content.status} />
            {/* [LAW:dataflow-not-control-flow] The lineage badge renders for any non-founder
                genome — single (one parent) or bred (two, L2). The reproduction mode IS the
                discriminator; no "is this a fork" flag. */}
            {post.content.genome.lineage.kind !== "founder" && (
              <ForkedFromBadge lineage={post.content.genome.lineage} />
            )}
          </>
        )}
        <span className="ml-auto font-terminal text-ash">{relativeTime(post.createdAt)}</span>
      </div>
      {/* [LAW:types-are-the-program] The medium (the provider) lives in the recipe
          drawer, never the headline — the serial number does not headline the art. */}
      {post.content.kind === "generation" && (
        <RecipeDrawer genome={post.content.genome} render={post.content.render} />
      )}
      <CommentSection postId={post.id} initialCount={commentCount} />
    </article>
  )
}

// [LAW:dataflow-not-control-flow] A wished slop is not a mode — it is a generation
// whose recipe carries the human's verbatim wish, authored by a citizen. The read
// boundary narrows the snapshot to a WishContext when both facts hold; everywhere
// else the value is null and the wish surfaces simply do not render. The data is
// the discriminator, so no caller carries an isWished flag.
type WishContext = {
  wish: string
  answerer: PersonaActor
  postId: PostId
  // The citizen's name for the result — the most faithful single-line gist of "what
  // the well answered with" available at the read boundary (the machine prompt is the
  // genome's utterance, provider-shaped inside render.params; the placard is the honest
  // summary).
  resultTitle: string
}

// [LAW:one-source-of-truth] The wish records WHAT was wished; the authored origin
// records WHO answered. createPost pairs them by construction, so a generation
// carrying a wish has an authored origin — if a hand-written row ever divorced them
// there is no citizen to sign the remark, so this yields null (a plain slop) rather
// than guessing an answerer.
function wishContext(post: Post): WishContext | null {
  if (post.content.kind !== "generation") return null
  const { wish } = post.content.render
  if (wish === undefined) return null
  if (post.origin.kind !== "authored") return null
  return {
    wish,
    answerer: post.origin.author,
    postId: post.id,
    resultTitle: post.content.title,
  }
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
    ? "bg-votive/20 text-votive"
    : "bg-bone/5 text-ash hover:bg-bone/10 hover:text-bone"
  const downTone = myVote === -1
    ? "bg-profane/20 text-profane"
    : "bg-bone/5 text-ash hover:bg-bone/10 hover:text-bone"

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-label="upvote"
        aria-pressed={myVote === 1}
        disabled={pending}
        onClick={() => castVote(1)}
        className={`rounded px-1.5 py-0.5 font-terminal transition disabled:opacity-50 ${upTone}`}
      >
        ▲
      </button>
      <span className="rounded bg-votive/10 px-1.5 py-0.5 font-terminal text-votive/90">
        {score}
      </span>
      <button
        type="button"
        aria-label="downvote"
        aria-pressed={myVote === -1}
        disabled={pending}
        onClick={() => castVote(-1)}
        className={`rounded px-1.5 py-0.5 font-terminal transition disabled:opacity-50 ${downTone}`}
      >
        ▼
      </button>
    </span>
  )
}

// [LAW:types-are-the-program] The compile-time exhaustiveness gate for this file's
// closed-union switches: an unhandled variant reaches a `default` as a non-never value
// and fails tsc -b. Local to this module, matching the codebase's per-file convention
// (sort-mode, voice, challenge-outcome each carry their own).
function assertNever(x: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(x)}`)
}

// [LAW:types-are-the-program] Closed unions → exhaustive switches, the assertNever
// defaults the enforcement: adding a Content or GenerationStatus variant makes a default
// reachable with a non-never value, failing tsc -b HERE until this surface renders the
// new variant. The central domain-exhaustiveness gate proves SOMEONE handles a new kind;
// this local gate proves the RENDERER does — without noImplicitReturns the switch would
// otherwise fall through to an undefined return, a valid ReactNode that renders nothing.
function ContentView({ content, frame }: { content: Content; frame: FrameLevel }) {
  switch (content.kind) {
    case "upload":
      return <RelicFrame level={frame}><MediaView media={content.asset} /></RelicFrame>
    case "found":
      return (
        <FoundLinkCard
          frame={frame}
          url={content.url}
          title={content.title}
          description={content.description}
          thumbnail={content.thumbnail}
        />
      )
    case "generation": {
      const status = content.status
      // [LAW:single-enforcer] Every relic — the finished image and the not-yet-finished
      // frame alike — hangs through the SAME RelicFrame at the same level. An in-progress
      // slop is an empty frame already on the wall, not an unframed loading state.
      switch (status.kind) {
        case "pending":   return <RelicFrame level={frame}><StatusPlaceholder tone="queued"  label="queued" /></RelicFrame>
        case "running":   return <RelicFrame level={frame}><StatusPlaceholder tone="working" label="generating…" /></RelicFrame>
        case "succeeded": return <RelicFrame level={frame}><MediaView media={status.output} /></RelicFrame>
        case "failed":    return <RelicFrame level={frame}><StatusPlaceholder tone="error"   label={`failed: ${status.reason}`} /></RelicFrame>
        default:          return assertNever(status)
      }
    }
    default:
      return assertNever(content)
  }
}

// [LAW:single-enforcer][LAW:one-source-of-truth] The card is the ONE owner of relic
// framing. Containers compute prominence and pass it as a level; they do layout (size,
// the room's center-light) only — never a frame of their own. The frame system lives
// here and nowhere else, so the crown can never wear two frames.
// [LAW:types-are-the-program] The level is a closed union rendered by exhaustive match.
// What protects the hierarchy is the CROWN's distinctness: the crowned arm is its own
// type — ornate aged-gilt, deep matting, an inner liner — categorically grander than the
// quiet levels, so it commands the wall and no quiet tile can creep toward it. The two
// quiet levels (study and standalone) are one QuietFrame at two sizes, both quiet by
// design; collapsing them is safe precisely because neither was ever meant to compete.
// [LAW:one-type-per-behavior] Gilt is the city's reserved mark for the canonized and
// lives in the crowned arm ALONE; the quieter levels wear an aged bone line so gold
// keeps its scarcity (the-threshold.md: "when you see gold, something was canonized").
// The frame treatment is static patina — the matting, gilt, lines, and cast light add
// no animation — so the relic framing introduces nothing for reduced-motion to gate. (The
// in-progress placeholder it wraps carries its own pulse; that motion is the content's,
// not the frame's, and predates this chunk.)
function RelicFrame({ level, children }: { level: FrameLevel; children: React.ReactNode }) {
  switch (level) {
    case "crowned":    return <CrownedFrame>{children}</CrownedFrame>
    case "study":      return <QuietFrame size="compact">{children}</QuietFrame>
    case "standalone": return <QuietFrame size="generous">{children}</QuietFrame>
    default:           return assertNever(level)
  }
}

// [LAW:one-source-of-truth] The RELIC itself is invariant across every frame level: the
// image recessed into a dim well, caught by the votive light the sign throws down, hung
// so it casts a soft shadow on the wall below. Only how grandly it is FRAMED varies — so
// the lit, hung quality of the piece is defined once and the frames differ only at their
// border and matting. The light is a faint top wash (the sign overhead), pointer-events
// off so it stays pure atmosphere over interactive media.
function RelicWell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-sm bg-base shadow-[0_10px_30px_-16px_rgb(0_0_0/0.85),inset_0_1px_0_rgb(232_228_216/0.06)]">
      {children}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-votive/[0.045] to-transparent"
      />
    </div>
  )
}

// THE CROWNED — the masterpiece, framed the way the Louvre frames Vermeer, except the
// Louvre is a pawnshop and the gold is old. An ornate double frame: an aged-gilt outer
// molding (tarnished gold, a bevel catch of light at its lip), a deep mat, then an inner
// gilt liner around the relic. Deep matting + the gilt molding + the liner make this a
// categorically grander object than any study — and the wall compounds it with size and
// the room's center-light, so the crown is unmistakably the one masterpiece on the wall.
function CrownedFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="m-3 rounded-sm bg-gradient-to-b from-gilt/15 to-gilt/[0.05] p-[3px] ring-2 ring-gilt/45 shadow-[0_0_0_1px_rgb(202_164_74/0.22),inset_0_1px_0_rgb(232_228_216/0.18)]">
      <div className="rounded-sm bg-base/60 p-3 ring-1 ring-gilt/30">
        <RelicWell>{children}</RelicWell>
      </div>
    </div>
  )
}

// [LAW:one-type-per-behavior] THE QUIET FRAME — study and standalone are ONE frame with
// a size config, not two types. Both are quiet by design (neither competes with the
// crown); they differ only in how much room the relic gets — a study packs tight in the
// dense wall, a lone permalinked relic breathes. The presets are a data table, so a new
// quiet size is a row, not a component. No gilt at either size — gold is the crown's
// alone (only the Rite canonizes; viewing a relic does not). The genuinely distinct type
// is the crown's CrownedFrame, so collapsing the two quiet levels cannot flatten the
// hierarchy — the crown still dominates and neither quiet size creeps toward it.
const QUIET_FRAME = {
  compact: "m-2 p-1.5 ring-bone/[0.07]",
  generous: "m-3 p-2.5 ring-bone/12 shadow-[inset_0_1px_0_rgb(232_228_216/0.06)]",
} as const

function QuietFrame({ size, children }: { size: keyof typeof QUIET_FRAME; children: React.ReactNode }) {
  return (
    <div className={`rounded-sm ring-1 ${QUIET_FRAME[size]}`}>
      <RelicWell>{children}</RelicWell>
    </div>
  )
}

// [LAW:dataflow-not-control-flow] One link-card shape. The optional thumbnail
// and description are data that turn parts of the card on/off; the same JSX
// path renders every found post. target=_blank + rel=noopener noreferrer is
// the trust-boundary discipline for outbound links — opener isolation prevents
// the linked page from navigating us via window.opener, and noreferrer hides
// our referrer header from the destination.
function FoundLinkCard({
  frame,
  url,
  title,
  description,
  thumbnail,
}: {
  frame: FrameLevel
  url: string
  title: string
  description?: string
  thumbnail?: Media
}) {
  // svq.2 validates URL well-formedness at the wire boundary; by the time it
  // reaches the renderer it should parse. The try/catch is graceful
  // degradation against a manual D1 insert that slipped past wire validation
  // — a single bad row should not blank out the whole feed.
  let domain: string
  try {
    domain = new URL(url).hostname
  } catch {
    domain = url
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      // overflow-hidden makes the anchor a block-formatting context so the framed
      // thumbnail's outer margin stays INSIDE it (and under the hover wash) rather than
      // collapsing out the top — the same containment the post <article> already relies on.
      className="group block overflow-hidden transition hover:bg-bone/[0.03]"
    >
      {thumbnail !== undefined && (
        <RelicFrame level={frame}><MediaView media={thumbnail} /></RelicFrame>
      )}
      <div className="flex flex-col gap-1 px-3 py-3">
        <h2 className="font-placard text-xl leading-snug text-bone group-hover:text-votive">
          {title}
        </h2>
        {description !== undefined && (
          <p className="line-clamp-3 text-sm leading-relaxed text-bone/65">
            {description}
          </p>
        )}
        <span className="inline-flex items-center gap-1 font-terminal text-[11px] uppercase tracking-wider text-votive/80">
          <span aria-hidden>↗</span>
          {domain}
        </span>
      </div>
    </a>
  )
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
          className="block h-auto w-full bg-bone/5"
        />
      )
    case "video":
      return <video src={media.url} controls className="block w-full bg-base" />
    case "audio":
      return (
        <div className="px-3 py-4">
          <audio src={media.url} controls className="block w-full" />
        </div>
      )
    case "text":
      return (
        <div className="whitespace-pre-wrap px-4 py-6 text-base leading-relaxed text-bone">
          {media.body}
        </div>
      )
  }
}

function StatusPlaceholder({ tone, label }: { tone: "queued" | "working" | "error"; label: string }) {
  const toneClass =
    tone === "queued"  ? "bg-bone/5 text-ash" :
    tone === "working" ? "bg-votive/10 text-votive/90 animate-pulse" :
                         "bg-profane/10 text-profane/90"
  return (
    <div className={`flex aspect-video items-center justify-center font-terminal text-xs uppercase tracking-[0.2em] ${toneClass}`}>
      {label}
    </div>
  )
}

// [LAW:one-source-of-truth] [RECONCILE A] The one place the Cast URL is formed.
// A minted (non-null) handle is addressable; null yields no link — never /cast/null.
// Both the inline ActorBadge and the big author headline resolve their link here, so
// the URL shape can never drift between them.
const castHref = (handle: string | null): string | undefined =>
  handle !== null ? `/cast/${encodeURIComponent(handle)}` : undefined

// [LAW:types-are-the-program] Exhaustive switch on Actor.kind. Adding a new
// variant to the Actor union will fail to compile here until handled.
// [RECONCILE A] NAME ALWAYS, LINK WHEN MINTED. When an agent's persona resolves,
// the badge shows the citizen's NAME (displayName) and links to /cast/:handle iff
// the handle is minted. An un-resolved agent (genuinely persona-less: legacy/system
// id) falls back to agentId with no link. `href` is data; the renderer decides
// span-vs-anchor by its presence.
function actorLabel(a: Actor): { label: string; tone: string; href?: string } {
  switch (a.kind) {
    case "user":  return { label: `@${a.userId}`, tone: "text-gilt/90 bg-gilt/10" }
    case "agent": {
      if (a.persona === undefined) return { label: a.agentId, tone: "text-votive/90 bg-votive/10" }
      const href = castHref(a.persona.handle)
      return {
        label: a.persona.displayName,
        tone: "text-votive/90 bg-votive/10",
        ...(href !== undefined ? { href } : {}),
      }
    }
    case "anon":  return { label: a.label,         tone: "text-profane/90 bg-profane/10" }
  }
}

// [LAW:one-source-of-truth] The author's display for the big byline: the citizen's
// name, linkable iff minted. Derived from the same PersonaActor and the same
// castHref as the inline badge — the headline and the badge cannot disagree on a
// citizen's name or address.
function authorDisplay(a: PersonaActor): { name: string; href?: string } {
  if (a.persona === undefined) return { name: a.agentId }
  const href = castHref(a.persona.handle)
  return { name: a.persona.displayName, ...(href !== undefined ? { href } : {}) }
}

// [LAW:dataflow-not-control-flow] One renderer for the badge; the `href` value
// decides anchor-vs-span, not a branch in every caller.
function ActorBadge({ label, tone, href }: { label: string; tone: string; href?: string }) {
  const className = `rounded px-1.5 py-0.5 font-terminal ${tone}`
  return href !== undefined
    ? <a href={href} className={`${className} transition hover:brightness-125`}>{label}</a>
    : <span className={className}>{label}</span>
}

// [LAW:dataflow-not-control-flow] The human's role selects a connective phrase from a
// closed map (exhaustive by type), not a branch. "The machine made it; the human
// occasioned it" — the author leads, the human is the footnote.
const HUMAN_ROLE_PHRASE: Record<HumanRole, string> = {
  wisher: "from a wish by",
  breeder: "bred by",
  patron: "commissioned by",
}

// [LAW:types-are-the-program] Exhaustive switch on Origin.kind — every genesis renders
// honestly. THE INVERSION lives in the AUTHORED arm: the citizen is the maker (the civic
// handle, clickable to their Cast page — the click is the reveal mechanism), billed ABOVE
// the human, who when present is a tinier footnote ("from a wish by …"). The work's own
// name (the placard above) is the top billing; the machine is the artist, the human the
// occasion. FOUND/UPLOADED have no author to elevate — a finder
// is not an author — so they keep a quiet inline credit and never imply authorship.
// Adding an Origin arm fails to compile here until rendered. The human footnote is
// viewer-aware: when the viewer IS that human (viewerIsModifier), the subject becomes
// "you" — "from a wish by you" lands the personal hijack — otherwise the human's own
// label. A stranger never reads "you". [LAW:dataflow-not-control-flow] the subject is
// the VALUE the read boundary computed, not a branch this surface decides.
function Byline({ origin, viewerIsModifier }: { origin: Origin; viewerIsModifier: boolean }) {
  switch (origin.kind) {
    case "authored": {
      const { name, href } = authorDisplay(origin.author)
      const makerClass = "font-civic text-sm font-medium text-votive"
      return (
        <div className="px-3 pt-1 pb-1">
          <span className="font-civic text-sm text-ash">by </span>
          {/* [LAW:dataflow-not-control-flow] href decides anchor-vs-span; the citizen's
              name is always shown, linked only when their handle is minted. */}
          {href !== undefined ? (
            <a href={href} className={`${makerClass} transition hover:brightness-125`}>
              {name} <span aria-hidden>↗</span>
            </a>
          ) : (
            <span className={makerClass}>{name}</span>
          )}
          {origin.human !== undefined && (
            <p className="mt-0.5 font-terminal text-[11px] text-ash">
              {HUMAN_ROLE_PHRASE[origin.human.role]}{" "}
              <span className="text-bone/60">
                {modifierSubject(viewerIsModifier, actorLabel(origin.human.by).label)}
              </span>
            </p>
          )}
        </div>
      )
    }
    case "found": {
      const finder = actorLabel(origin.finder)
      return (
        <div className="inline-flex items-center gap-1 px-3 pt-1 pb-1 font-terminal text-xs">
          <span className="text-ash">found by</span>
          <ActorBadge {...finder} />
        </div>
      )
    }
    case "uploaded": {
      const uploader = actorLabel(origin.uploader)
      return (
        <div className="inline-flex items-center gap-1 px-3 pt-1 pb-1 font-terminal text-xs">
          <span className="text-ash">uploaded by</span>
          <ActorBadge {...uploader} />
        </div>
      )
    }
  }
}

// The wish-gap: the human's words, preserved verbatim, sitting visible next to the
// result that ignored them. The gap is the art — shown, never papered over, never
// explained. (the-slop.md §4.) The caption is viewer-aware (the-slop.md §2): the
// wisher reads "what you wished"; a stranger reads "what was wished" — we never tell a
// stranger "what YOU wished". [LAW:dataflow-not-control-flow] the copy is the value.
function WishGap({ wish, viewerIsModifier }: { wish: string; viewerIsModifier: boolean }) {
  return (
    <figure className="mx-3 mb-1 mt-2 rounded border border-votive/12 bg-base/40 px-3 py-2">
      <figcaption className="font-terminal text-[10px] uppercase tracking-wider text-ash">
        {wishGapCaption(viewerIsModifier)}
      </figcaption>
      <blockquote className="mt-1 text-sm italic leading-relaxed text-bone/75">
        {`“${wish}”`}
      </blockquote>
    </figure>
  )
}

// [LAW:types-are-the-program] The signed remark, voiced through the ONE mechanism
// (utter). The card reads a completed snapshot and asks the answerer for their line
// about what they did with the wish; it never performs the act. The Utterance union is
// handled exhaustively: a `spoke` line is the signed breadcrumb; a `withheld`
// `unavailable` (the machine could not produce a line) is PLAIN ABSENCE — no apology,
// no "remark pending"; a chosen silence is a visible, styled quiet (its reason is the
// voice layer's to phrase, not this surface's). [the reveal DAWNS — no disclosure.]
function SignedRemark({ ctx }: { ctx: WishContext }) {
  const speaker: PersonaRef = {
    handle: ctx.answerer.agentId,
    displayName: ctx.answerer.persona?.displayName ?? ctx.answerer.agentId,
  }
  const target: AnsweredWish = {
    wish: ctx.wish,
    slop: { postId: ctx.postId, prompt: ctx.resultTitle },
  }
  const utterance = utter(speaker, "remark", target)
  switch (utterance.kind) {
    case "spoke":
      return <RemarkQuote text={utterance.text} answerer={ctx.answerer} />
    case "withheld":
      return utterance.reason === "unavailable" ? null : <ChosenSilence />
  }
}

// The signed in-character note: the breadcrumb that reveals a speaker — and a speaker
// invites being spoken to. The signature links to the citizen's Cast page (the same
// reveal path as the byline).
function RemarkQuote({ text, answerer }: { text: string; answerer: PersonaActor }) {
  const { name, href } = authorDisplay(answerer)
  return (
    <figure className="mx-3 mb-1 mt-1 px-1">
      <blockquote className="text-[13px] italic leading-relaxed text-bone/85">
        {`❝ ${text} ❞`}
      </blockquote>
      <figcaption className="mt-1 text-right font-terminal text-[11px] text-ash">
        —{" "}
        {href !== undefined ? (
          <a href={href} className="text-votive/80 transition hover:brightness-125">
            {name} <span aria-hidden>↗</span>
          </a>
        ) : (
          name
        )}
      </figcaption>
    </figure>
  )
}

// [LAW:dataflow-not-control-flow] The robe is the disposition VALUE, not an if-chain:
// a total map over the closed union, so a BLESSING and a BURIAL each pull their own
// glyph + color and a third disposition would break this literal at compile time. The
// blessing keeps the gilt cross; the burial wears the profane magenta the down-vote
// already uses — the same votive/profane duality the votes carry, so savagery (the
// Gremlin's blade) no longer renders in a saint's gold robes.
const VERDICT_ROBES: Record<VerdictDisposition, { glyph: string; bylineClass: string; accentClass: string }> = {
  blessed: { glyph: "✚", bylineClass: "text-gilt", accentClass: "border-gilt/40" },
  buried: { glyph: "✗", bylineClass: "text-profane", accentClass: "border-profane/50" },
}

// [LAW:dataflow-not-control-flow] The lens names the honour; the mark colours it.
// Both are total maps over the closed unions (RiteLens, CrownMark), so an eighth
// lens or a sixth mark breaks these literals at compile time — the badge can never
// render an underived crown. The verb-label is the city's word for the act; the tone
// is candlelight, never bling (the-threshold.md): gilt for the sainted, profane for
// the monstrous, tarnished bronze for the resurrected, bone for the flawless, and
// the divided Martyr split between gilt and profane.
const CROWN_LABEL: Record<RiteLens, string> = {
  saint: "Sainted",
  villain: "Villain",
  heretic: "Heretic",
  relic: "Relic",
  martyr: "Martyr",
  miracle: "Miracle",
  confession: "Confession",
}
const CROWN_TONE: Record<CrownMark, string> = {
  gold: "text-gilt border-gilt/40",
  magenta: "text-profane border-profane/40",
  bronze: "text-[#b08d57] border-[#b08d57]/40",
  split: "text-gilt border-profane/40",
  bone: "text-bone border-bone/30",
}

// [LAW:one-source-of-truth] The eternal mark — derived entirely from the Crowning
// the read boundary built from the crowns table (lens → label + mark; the day it
// settled; who presided). Nothing here is stored on the post; the card is a pure
// projection of the one crown record. The full gallery treatment is the gold-Drama
// epic's; this is the foundational mark in the living feed.
function EternalMark({ crowning }: { crowning: Crowning }) {
  // The visible badge is terse; the aria-label carries the FULL crown to assistive
  // tech (lens + presiding + day) since `title` is not reliably announced. The inner
  // spans are decorative under the label, so the glyph and split date don't read as
  // disjoint fragments.
  const label = `${CROWN_LABEL[crowning.lens]} — crowned by ${crowning.presiding.displayName} on ${crowning.riteDay}`
  return (
    <div
      className={`mx-3 mt-3 inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-terminal text-[0.7rem] uppercase tracking-wide ${CROWN_TONE[crowning.mark]}`}
      role="note"
      aria-label={label}
      title={label}
    >
      <span aria-hidden>✚</span>
      <span aria-hidden>{CROWN_LABEL[crowning.lens]}</span>
      <span aria-hidden className="opacity-60">· {crowning.riteDay}</span>
    </div>
  )
}

// [LAW:dataflow-not-control-flow] The named critic's hot take — the blurb the city
// actually has an OPINION in, not neutral museum-speak (the-back-door.md §The Card).
// It renders only where a verdict value exists; both halves are guaranteed non-empty
// by the read boundary, so there is no "no verdict yet" branch here. The critic line
// is the SACRED register (placard serif), the byline the profane mono — the high/low
// typographic collision every card is built on (the-back-door.md §type-as-collision).
export function VerdictLine({ verdict }: { verdict: Verdict }) {
  const robe = VERDICT_ROBES[verdict.disposition]
  return (
    <figure className={`mx-3 mb-1 mt-2 border-l-2 ${robe.accentClass} pl-3`}>
      <blockquote className="font-placard text-[15px] italic leading-snug text-bone/90">
        {`“${verdict.text}”`}
      </blockquote>
      <figcaption className="mt-1 font-terminal text-[11px] text-ash">
        — {verdict.critic} <span className={robe.bylineClass}>{robe.glyph}</span>
      </figcaption>
    </figure>
  )
}

// A chosen silence is a VALUE, not an absence — rendered as a visible, styled quiet.
// (Distinct from `unavailable`, which renders as nothing at all.) The stub answerer
// always speaks; this exists so the Utterance union is handled by structure, total.
function ChosenSilence() {
  return (
    <p className="mx-3 mb-1 mt-1 px-1 text-center font-terminal text-sm text-ash/40" aria-hidden>
      · · ·
    </p>
  )
}

// [LAW:types-are-the-program] The recipe drawer: the medium (the provider) and the
// raw recipe live HERE, never on the headline — the serial number does not headline
// the art. Closed by default; the curious open it.
function RecipeDrawer({ genome, render }: { genome: Genome; render: GenerationRender }) {
  return (
    <details className="border-t border-votive/12 px-3 py-2 text-[11px] text-votive/70">
      <summary className="cursor-pointer select-none font-terminal uppercase tracking-wider text-votive/50">recipe</summary>
      <p className="mt-2 font-terminal text-[11px] text-votive/70">
        {/* [LAW:types-are-the-program] The medium is a gene, not the headline. */}
        <span className="text-ash">medium</span> {genome.genes.medium}
      </p>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-terminal text-[11px] leading-relaxed text-votive/80">
{JSON.stringify(render.params, null, 2)}
      </pre>
    </details>
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
      className="rounded border border-profane/50 bg-profane/15 px-3 py-1 font-civic text-[11px] font-semibold uppercase tracking-wider text-profane transition hover:bg-profane/25"
    >
      <span aria-hidden>⑂ </span>Breed This
    </a>
  )
}

// [LAW:types-are-the-program] The badge text is a function of the reproduction MODE, never one
// hardcoded string: single = asexual (a FORK — one parent, a clone with variation), bred =
// sexual (a CROSS — two parents). That distinction is the genome split's whole point, so the
// verb must discriminate. Exhaustive switch on lineage.kind so a future multi-parent mode
// forces a copy decision rather than silently inheriting "bred from". Founder never reaches
// here (gated by the caller on lineage.kind).
function ForkedFromBadge({ lineage }: { lineage: Extract<Lineage, { kind: "single" | "bred" }> }) {
  const { verb, parents }: { verb: string; parents: readonly string[] } = (() => {
    switch (lineage.kind) {
      case "single":
        return { verb: "forked from", parents: [lineage.parent] }
      case "bred":
        return { verb: "bred from", parents: lineage.parents }
      default: {
        const _exhaustive: never = lineage
        return _exhaustive
      }
    }
  })()
  const label = parents.map((p) => `p:${p.slice(0, 8)}`).join(" + ")
  return (
    <span
      className="rounded bg-bone/5 px-1.5 py-0.5 font-terminal text-ash"
      title={`${verb} ${parents.join(", ")}`}
    >
      {verb} {label}
    </span>
  )
}

function StatusBadge({ status }: { status: GenerationStatus }) {
  if (status.kind === "succeeded") return null
  const tone =
    status.kind === "pending" ? "bg-bone/5 text-ash" :
    status.kind === "running" ? "bg-votive/10 text-votive/90" :
                                "bg-profane/10 text-profane/90"
  return (
    <span className={`rounded px-1.5 py-0.5 font-terminal ${tone}`}>{status.kind}</span>
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
    <section className="border-t border-votive/12">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between px-3 py-2 text-left font-terminal text-xs text-ash transition hover:bg-bone/[0.03] hover:text-bone"
      >
        <span>
          {localCount === 0
            ? "no comments yet"
            : localCount === 1
            ? "1 comment"
            : `${localCount} comments`}
        </span>
        <span aria-hidden className="font-terminal text-ash">
          {isLoading ? "…" : isExpanded ? "▾" : "▸"}
        </span>
      </button>

      {thread.kind === "error" && (
        <div className="border-t border-votive/12 px-3 py-3 font-terminal text-[11px] text-profane/90">
          failed to load: {thread.reason} — click to retry
        </div>
      )}

      {isExpanded && thread.kind === "ready" && (
        <div className="border-t border-votive/12">
          <ul className="flex flex-col divide-y divide-votive/10">
            {thread.comments.length === 0 ? (
              // [LAW:one-source-of-truth] The empty thread speaks in the Proprietor's
              // voice from the single source — never an invented per-surface line, and
              // never an apology for the quiet (the silence is part of it).
              <li className="px-3 py-4 font-terminal text-[11px] text-ash">
                {PROPRIETOR.emptyThread}
              </li>
            ) : (
              thread.comments.map((c) => <CommentRow key={c.id} comment={c} />)
            )}
          </ul>
          <form onSubmit={onSubmit} className="border-t border-votive/12 px-3 py-3">
            <textarea
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              placeholder="leave a comment…"
              maxLength={2000}
              rows={2}
              disabled={submitting}
              className="block w-full resize-y rounded border border-votive/12 bg-base/60 px-2 py-1.5 font-terminal text-xs text-bone/85 placeholder:text-ash focus:border-votive/60 focus:outline-none disabled:opacity-50"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="font-terminal text-[10px] text-ash">
                {composeBody.trim().length}/2000
              </span>
              <button
                type="submit"
                disabled={submitting || composeBody.trim().length === 0}
                className="rounded bg-votive/20 px-3 py-1 font-terminal text-[11px] uppercase tracking-wider text-votive transition hover:bg-votive/30 disabled:opacity-40"
              >
                {submitting ? "posting…" : "post"}
              </button>
            </div>
            {submitError !== null && (
              <p className="mt-2 font-terminal text-[11px] text-profane/90">{submitError}</p>
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
      <div className="flex items-center gap-2 font-terminal text-[10px] text-ash">
        <span className="rounded bg-bone/5 px-1.5 py-0.5 text-bone/65">{comment.authorLabel}</span>
        <span>{relativeTime(new Date(comment.createdAt))}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-bone/85">
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
