import type { Route } from "./+types/breed.$id"
import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { z } from "zod"
import { getBreedablePool, getFeedItemById } from "~/db/feed"
import { readVoterId } from "~/lib/voter-cookie"
import { PostId, type RenderablePost } from "~/lib/domain"
import { forkPause, type BreedPause } from "~/lib/breed-failure"

// [LAW:locality-or-seam] Page route only — loader + default export. The submit-side action lives
// at /api/breed/:id (a resource route), mirroring fork's page/resource split (RR7's document-route
// CSRF gate needs x-forwarded-host the vite-plugin dev server omits; the same-origin defense lives
// at the resource boundary). The Breeding Room is the HUMAN breeder's surface — a distinct PLACE
// for a distinct ACT. The doorway on a card carries parent A in (the slop loved first); this room
// is where the breeder finds mate B and witnesses the cross. NO prompt box — mates, not words.

// [LAW:types-are-the-program] A breedable slop is a generation whose render SUCCEEDED (it has an
// image to show and a genome to cross). The loader projects each candidate to exactly what the
// room renders — no nullable image, no "incomplete" payload reaching the component.
type Slop = { id: string; shortId: string; title: string; imageUrl: string }

// [LAW:decomposition] Voice copy lives with the surface that speaks it.
// [LAW:types-are-the-program] Exhaustive over BreedPause; `tsc -b` enforces completeness.
function breedPauseVoice(pause: BreedPause): string {
  switch (pause.reason) {
    case 'muse-unreachable': return 'breed paused — the spirit that re-authors the cross has gone quiet; try again shortly'
    case 'muse-empty':       return 'breed paused — the muse came back empty-handed; try again'
    case 'out-of-budget':    return 'breed paused — the city has spent all it has tonight; the breeding room reopens by morning'
    case 'unknown':          return 'breed paused — something went wrong; try again shortly'
    default: { const _: never = pause; return _ }
  }
}

// Project a renderable post to a breedable Slop, or null if it carries no crossable phenotype.
// Takes the RenderablePost base so both the permalink read (parent A) and the feed (mates) feed it.
function toSlop(item: RenderablePost): Slop | null {
  const { post } = item
  if (post.content.kind !== "generation") return null
  if (post.content.status.kind !== "succeeded") return null
  // [LAW:types-are-the-program] output exists ONLY on the succeeded variant — the guard above
  // narrows it, so the url is reached by structure, never a nullable access.
  const output = post.content.status.output
  if (output.kind !== "image") return null
  return {
    id: post.id,
    shortId: post.id.slice(0, 8),
    title: post.content.title,
    imageUrl: output.url,
  }
}

type LoaderData = { parent: Slop; mates: Slop[] }

export async function loader({ request, params, context }: Route.LoaderArgs): Promise<LoaderData> {
  const env = context.cloudflare.env
  const voterId = readVoterId(request)

  const parentItem = await getFeedItemById(env, PostId(params.id), voterId)
  if (parentItem === null) throw new Response("post not found", { status: 404 })
  const parent = toSlop(parentItem)
  // [LAW:types-are-the-program] Only a succeeded generation can be carried into the room. A found
  // / upload / pending post has no genome to cross — defend the direct-URL path loudly.
  if (parent === null) throw new Response("only finished generations can be bred", { status: 400 })

  // The room is for finding mate B from the WHOLE breedable gene pool (every succeeded generation),
  // not one page of the homepage Hot feed. The pool is seeded-shuffled and windowed: a `seed` in the
  // URL drives a deterministic slice (reproducible, shareable), and a fresh seed reshuffles to a
  // different slice — so over reshuffles every genome is reachable as a mate, honoring "slop has
  // heritable DNA." Absent `seed` defaults to parent A's id: a stable, shareable first look per slop.
  const url = new URL(request.url)
  const seed = url.searchParams.get("seed") ?? params.id

  const pool = await getBreedablePool(env, { excludeId: PostId(params.id), seed, voterId })
  // [LAW:types-are-the-program] The pool is already breedable by construction (the query filters to
  // succeeded generations, parent excluded), so toSlop drops nothing here — the filter only narrows
  // the Slop|null projection. The mate count is now REAL, never a feed page minus ineligible posts.
  const mates = pool.map(toSlop).filter((s): s is Slop => s !== null)

  return { parent, mates }
}

const breedResponseSchema = z.object({ id: z.string().min(1) })

export default function BreedingRoom({ loaderData }: Route.ComponentProps) {
  const { parent, mates } = loaderData
  const navigate = useNavigate()
  const [mateId, setMateId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [pauseHeadline, setPauseHeadline] = useState<string | null>(null)

  async function breed() {
    if (mateId === null || pending) return
    setPending(true)
    setPauseHeadline(null)
    try {
      const resp = await fetch(`/api/breed/${parent.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mateId }),
      })
      if (!resp.ok) {
        // [LAW:no-silent-fallbacks] The HTTP status carries the failure; map it to the breeding
        // room's honest voice (the same pause vocabulary fork uses) and keep the raw status loud
        // in the console for diagnosis.
        console.error("breed failed", resp.status, await resp.text())
        setPauseHeadline(breedPauseVoice(forkPause(resp.status)))
        setPending(false)
        return
      }
      const { id } = breedResponseSchema.parse(await resp.json())
      navigate(`/p/${id}`)
    } catch (e) {
      console.error("breed failed", e)
      setPauseHeadline(breedPauseVoice(forkPause(0)))
      setPending(false)
    }
  }

  // Reshuffle = a fresh seed in the URL → the loader draws a different slice of the same gene pool.
  // Clearing the selection first keeps the chosen mate honest: the picked slop need not survive into
  // the new window, so a stale selection is dropped rather than left pointing at a hidden card.
  function reshuffle() {
    setMateId(null)
    navigate(`?seed=${crypto.randomUUID()}`)
  }

  const mate = mateId === null ? null : mates.find((m) => m.id === mateId) ?? null

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-10 px-4 py-12">
      <header>
        <h1 className="font-placard text-3xl font-semibold text-bone">The Breeding Room</h1>
        <p className="mt-3 max-w-2xl font-civic text-sm leading-relaxed text-ash">
          You carried <strong className="text-bone">“{parent.title}”</strong> in. Find its mate
          below; the city crosses the two into a third that carries both faces. You choose the mates
          — the machine authors the child.
        </p>
      </header>

      <section className="flex items-end justify-center gap-5">
        <figure className="flex w-44 flex-col gap-2">
          <img
            src={parent.imageUrl}
            alt={parent.title}
            loading="lazy"
            className="aspect-[3/4] w-full rounded border border-votive/25 bg-panel object-cover"
          />
          <figcaption className="flex flex-col gap-0.5">
            <span className="font-terminal text-[10px] uppercase tracking-wider text-ash">Parent A — carried in</span>
            <strong className="font-placard text-sm text-bone">{parent.title}</strong>
          </figcaption>
        </figure>

        <div className="pb-12 font-placard text-2xl text-profane" aria-hidden>
          ✕
        </div>

        <figure className="flex w-44 flex-col gap-2">
          {mate === null ? (
            <div className="flex aspect-[3/4] w-full items-center justify-center rounded border border-dashed border-profane/40 px-2 text-center font-civic text-xs uppercase tracking-wider text-profane/70">
              choose a mate ▸
            </div>
          ) : (
            <>
              <img
                src={mate.imageUrl}
                alt={mate.title}
                loading="lazy"
                className="aspect-[3/4] w-full rounded border border-profane/50 bg-panel object-cover"
              />
              <figcaption className="flex flex-col gap-0.5">
                <span className="font-terminal text-[10px] uppercase tracking-wider text-ash">Parent B — the mate</span>
                <strong className="font-placard text-sm text-bone">{mate.title}</strong>
              </figcaption>
            </>
          )}
        </figure>
      </section>

      <div className="flex flex-col items-center gap-2">
        {/* [LAW:types-are-the-program] The idle↔busy label is a DISCRETE state (it
            swaps atomically with `pending`); the hover tint is a CONTINUOUS
            affordance. `transition-colors` (not the broad `transition`) animates
            only the colour group, so `disabled:opacity-40` flips instantly instead
            of riding a 150ms opacity transition that promotes the button to its own
            compositor layer and cross-fades the old label's paint into the new one —
            the two states becoming legible at once. Scoping the transition makes them
            mutually exclusive at the paint layer by construction, not on a timer. */}
        <button
          type="button"
          className="rounded border border-profane/60 bg-profane/20 px-6 py-2 font-civic text-sm font-semibold uppercase tracking-wider text-profane transition-colors hover:bg-profane/30 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={mateId === null || pending}
          onClick={breed}
        >
          {pending ? "the city is crossing them…" : "✕ Breed Them"}
        </button>
        {pauseHeadline !== null && <p className="font-civic text-sm text-profane">{pauseHeadline}</p>}
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-placard text-lg text-bone">Find the mate</h2>
          <button
            type="button"
            onClick={reshuffle}
            className="font-terminal text-xs uppercase tracking-[0.2em] text-ash transition-colors hover:text-bone"
          >
            ↻ different mates
          </button>
        </div>
        {mates.length === 0 ? (
          <p className="font-civic text-sm text-ash">
            The gene pool is thin right now — no other slops to cross with yet.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {mates.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={`group flex w-full flex-col gap-1 rounded border bg-panel p-1 text-left transition ${
                    m.id === mateId ? "border-profane bg-profane/15" : "border-votive/15 hover:border-votive/40"
                  }`}
                  aria-pressed={m.id === mateId}
                  onClick={() => setMateId(m.id)}
                >
                  <img
                    src={m.imageUrl}
                    alt={m.title}
                    loading="lazy"
                    className="aspect-square w-full rounded-sm object-cover"
                  />
                  <span className="truncate px-1 font-placard text-xs text-bone/80">{m.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p>
        <Link
          to={`/p/${parent.id}`}
          className="font-terminal text-xs uppercase tracking-[0.2em] text-ash transition-colors hover:text-bone"
        >
          ← back to “{parent.title}”
        </Link>
      </p>
    </main>
  )
}
