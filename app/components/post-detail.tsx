import type { RenderablePost } from "~/lib/domain"
import {
  Byline,
  CommentSection,
  ContentView,
  EternalMark,
  Exchange,
  ForkedFromBadge,
  ForkLink,
  BreedLink,
  LineageStatBadge,
  RecipeDrawer,
  relativeTime,
  SignedRemark,
  StatusBadge,
  Verdicts,
  VoteControls,
  WishGap,
  wishContext,
} from "~/components/post-card"

// [LAW:decomposition] THE OBJECT PAGE. The feed tile (PostCard) and this are two viewpoints
// of one RenderablePost: the tile is the dense glance, this is the complete object hung as a
// PAGE (the-wall.md: "the full card … is the permalink / expanded view; the tile is the dense
// view"). The difference is ARRANGEMENT and SCALE — a museum's hung work + its wall label,
// not a card in a column — while every leaf (media, byline, votes, verdicts, recipe, comments)
// is the SAME single-sourced part the tile renders. So the two never drift on what a part shows,
// only on how the object is laid out.
//
// [LAW:single-enforcer] The no-self-link SEAM sei.1 left: the object is not a preview of itself.
// The relic hero passes `permalinkHref={undefined}` into the SAME ContentView the tile uses, so
// the media renders bare (no /p/:id anchor, no "open ↗" cue) by construction — found's relic still
// links OUTBOUND (a link-post's purpose, ContentView's own concern), and the timestamp below is
// plain <time>, never a self-link. Nothing here re-derives the seam; it reuses the part that owns it.
export function PostDetail({
  post,
  score,
  myVote,
  commentCount,
  viewerIsModifier,
  verdicts,
  exchange,
  crowning,
  generationDepth,
  descendantCount,
}: RenderablePost) {
  // [LAW:dataflow-not-control-flow] Same derivation the tile runs: a non-null WishContext is a
  // property of the snapshot (a generation carrying the human's verbatim wish, authored by a
  // citizen), never an isWished flag. Its presence turns the wish-gap + signed remark on.
  const wish = wishContext(post)
  const createdIso = post.createdAt.toISOString()
  return (
    <article className="overflow-hidden rounded-lg border border-votive/12 bg-panel">
      {/* The work hung on the wall, its label beside it. On a wide screen the relic takes the
          room (the media is the hero, given space) and the label reads down the side; on a phone
          the label stacks beneath the work. [LAW:dataflow-not-control-flow] one markup, the
          viewport decides the split — not a mode. */}
      <div className="grid gap-px bg-votive/10 lg:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]">
        {/* THE RELIC — large, centred, given the room a tile denies it. Reuses ContentView so
            every content kind + generation status renders exactly as the tile does; the standalone
            frame + undefined href keep it bare (no self-link). */}
        <div className="flex items-center justify-center bg-panel p-3 sm:p-4 lg:p-6">
          <div className="w-full max-w-2xl">
            <ContentView content={post.content} frame={{ kind: "standalone" }} permalinkHref={undefined} />
          </div>
        </div>
        {/* THE WALL LABEL — the placard, the maker, the verdicts, the acts. The name is the
            biggest text (the-threshold.md: the name of a work has top billing), the machine guts
            (recipe) sit quiet at the bottom. */}
        <aside className="flex flex-col gap-2 bg-panel px-4 py-5">
          {/* [LAW:dataflow-not-control-flow] The eternal mark renders by the PRESENCE of a Crowning
              (derived from the crowns table), never an isCrowned flag. */}
          {crowning !== undefined && <EternalMark crowning={crowning} />}
          {/* [LAW:types-are-the-program] The placard renders for a generation by the discriminator —
              the title is guaranteed on that arm. On the object it is plain text at page scale (the
              biggest thing on the label), never a self-link. */}
          {post.content.kind === "generation" && (
            <h2 className="font-placard text-3xl font-black leading-tight text-bone sm:text-4xl">
              {post.content.title}
            </h2>
          )}
          <Byline origin={post.origin} viewerIsModifier={viewerIsModifier} />
          {/* [LAW:dataflow-not-control-flow] The wish-gap + signed remark render iff the snapshot is
              a wished one — the human's words verbatim beside the result that ignored them, and the
              answerer's in-character note. Shown, never disclosed by a modal. */}
          {wish !== null && (
            <>
              <WishGap wish={wish.wish} viewerIsModifier={viewerIsModifier} />
              <SignedRemark ctx={wish} />
            </>
          )}
          <Verdicts verdicts={verdicts} />
          <Exchange exchange={exchange} />
          {/* The acts. [LAW:one-source-of-truth] identical gating to the tile — a fork/breed door
              and lineage badges exist only for a generation (an upload/found carries no recipe), and
              breed only once a phenotype has succeeded. The value decides what renders, not a flag. */}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <VoteControls postId={post.id} initialScore={score} initialMyVote={myVote} />
            {post.content.kind === "generation" && (
              <>
                <ForkLink postId={post.id} />
                {post.content.status.kind === "succeeded" && <BreedLink postId={post.id} />}
                <StatusBadge status={post.content.status} />
                {post.content.genome.lineage.kind !== "founder" && (
                  <ForkedFromBadge lineage={post.content.genome.lineage} />
                )}
                {generationDepth > 0 && <LineageStatBadge label={`gen ${generationDepth}`} />}
                {descendantCount > 0 && (
                  <LineageStatBadge label={descendantCount === 1 ? "1 bred" : `${descendantCount} bred`} />
                )}
              </>
            )}
            {/* [LAW:single-enforcer] The object's own timestamp is plain <time>, never a self-link
                (the tile's timestamp is that card's detail door; the object IS the destination). The
                semantic dateTime carries the machine-readable instant; the visible text stays terse. */}
            <time dateTime={createdIso} title={createdIso} className="ml-auto font-terminal text-ash">
              {relativeTime(post.createdAt)}
            </time>
          </div>
          {/* [LAW:types-are-the-program] The medium (provider) + raw recipe live in the drawer, never
              the headline — the serial number does not headline the art. Generation only. */}
          {post.content.kind === "generation" && (
            <div className="mt-1 overflow-hidden rounded border border-votive/12">
              <RecipeDrawer genome={post.content.genome} render={post.content.render} />
            </div>
          )}
        </aside>
      </div>
      {/* THE CONVERSATION — the comment thread entry point, given the full width beneath the work
          because it is about the whole object, not the label. The same CommentSection the tile hangs. */}
      <CommentSection postId={post.id} initialCount={commentCount} />
    </article>
  )
}
