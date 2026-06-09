import { Link } from "react-router"
import type { Crowning, CrownMark, Media, RenderablePost } from "~/lib/domain"
import { CrownedPostCard } from "~/components/post-card"

// [LAW:types-are-the-program] The hero is a RenderablePost that IS crowned — the
// `crowning` RenderablePost leaves optional is REQUIRED here, so "a hero with no crown
// to colour it" is unrepresentable. The home loader narrows by the value (a crown exists
// or it does not); past that narrowing the mark is always in hand.
export type CrownedRenderable = RenderablePost & { crowning: Crowning }

// [LAW:types-are-the-program] A Deliberation contender carries EXACTLY what the held-breath
// teaser renders — an image thumbnail and its permalink target — nothing more. The loader
// narrows a resolved RenderablePost to this shape, so the banner never re-reaches into the
// content union; a contender with no settled image is simply not one.
export type Contender = {
  readonly postId: string
  readonly media: Extract<Media, { kind: "image" }>
}

// [LAW:types-are-the-program] The Rite banner's three real states, made one closed union
// the home loader produces and RiteHero consumes by exhaustive switch. `settled` — the
// standing crown reigns (every hour but the held breath). `deliberation` — the 2–3am
// hour: the city's front-runners shown WITHOUT a verdict (the ballot is the cron's, at
// three). `empty` — no crown has ever settled. The phase is the discriminator; there is
// no time logic in this component, because the loader read the clock once at its boundary.
export type RitePhase =
  | { readonly phase: "settled"; readonly hero: CrownedRenderable }
  | { readonly phase: "deliberation"; readonly contenders: readonly Contender[] }
  | { readonly phase: "empty" }

// [LAW:one-source-of-truth] The banner's gilt relic must never ALSO hang as a wall tile —
// only the settled crown is the singular gilt, so only it is excluded from the wall below.
// Deliberation contenders are minor teasers (no gilt); they may also appear in the wall.
// The home loader AND the client append-filter both derive the exclusion from here, so the
// "one relic, never also a tile" rule has a single owner across SSR and infinite scroll.
export function bannerExcludeId(phase: RitePhase): string | null {
  return phase.phase === "settled" ? phase.hero.post.id : null
}

// [LAW:dataflow-not-control-flow] The hero's halo is the mark — a total map over CrownMark
// (a sixth breaks this literal at compile time), so the gold case glows gold, the villain
// profane, the relic bronze. The room's overhead light is votive; this halo is the crown's
// OWN light, the candle the canonized relic sits in. [the gilt-scarcity lock] gold here
// only for a Saint, the same scarcity the frame and seal hold.
const HERO_HALO: Record<CrownMark, string> = {
  gold:    "shadow-[0_0_90px_-20px_rgb(202_164_74/0.55)]",
  magenta: "shadow-[0_0_90px_-20px_rgb(255_45_155/0.5)]",
  bronze:  "shadow-[0_0_90px_-20px_rgb(176_141_87/0.5)]",
  split:   "shadow-[0_0_90px_-20px_rgb(202_164_74/0.5)]",
  bone:    "shadow-[0_0_90px_-20px_rgb(232_228_216/0.4)]",
}

// THE RITE HERO — today's crowned relic, hung LARGE and lit, a second focal point beyond
// the wall that says this place has taste and a daily life (the-haunted-gallery.md move D).
// [LAW:single-enforcer] It is the ONLY caller of CrownedPostCard, the one producer of the
// gilt frame, so the canonization molding is the Rite's alone; the wall below wears votive.
// [LAW:dataflow-not-control-flow] The PHASE is the discriminator: the home page calls this
// UNCONDITIONALLY and lets the value decide which face shows — settled crown, held-breath
// Deliberation, or nothing — never a caller-side guard on the clock or the crown's presence.
export function RiteHero({ phase }: { phase: RitePhase }) {
  switch (phase.phase) {
    case "empty":
      return null
    case "settled":
      return <SettledCrown hero={phase.hero} />
    case "deliberation":
      return <Deliberation contenders={phase.contenders} />
    default: {
      // [LAW:types-are-the-program] a fourth phase breaks the build here, not at runtime.
      const _exhaustive: never = phase
      return _exhaustive
    }
  }
}

// The standing crown — the gilt relic, hung wide and lit by its own mark's halo. The
// `crown-settle` motion is the gold *settling in* (a slow candlelit fade on arrival, never
// a confetti pop, never a bounce — the-daily-rite.md §The Crowning); under reduced-motion
// it simply appears, already lit.
function SettledCrown({ hero }: { hero: CrownedRenderable }) {
  return (
    <section aria-label="the city's standing crown" className="mx-auto mb-12 max-w-3xl px-4">
      <p className="mb-3 text-center font-terminal text-[11px] uppercase tracking-[0.3em] text-ash">
        ·· today&apos;s rite · presided by{" "}
        <span className="text-bone/70">{hero.crowning.presiding.displayName}</span> ··
      </p>
      <div className={`crown-settle rounded-lg ${HERO_HALO[hero.crowning.mark]}`}>
        <CrownedPostCard {...hero} mark={hero.crowning.mark} />
      </div>
    </section>
  )
}

// THE DELIBERATION — the held breath, 2–3am UTC. The banner dims to a low flicker and shows
// the night's loud front-runners WITHOUT a verdict; the Proprietor is still considering, and
// the ballot may yet crown a quieter monarchical pick (the-daily-rite.md §The Deliberation).
// [LAW:dataflow-not-control-flow] the contenders are a VALUE; an empty list renders the held
// breath with no tiles (the city was quiet tonight), never a separate branch.
function Deliberation({ contenders }: { contenders: readonly Contender[] }) {
  return (
    <section
      aria-label="the rite is deliberating"
      className="rite-deliberate mx-auto mb-12 max-w-3xl px-4 text-center"
    >
      <p className="mb-3 font-terminal text-[11px] uppercase tracking-[0.3em] text-ash">
        ·· tonight&apos;s rite · the back door is deciding ··
      </p>
      <p className="mb-5 font-placard text-2xl font-black tracking-tight text-gilt/70">
        The back door is deciding. Come back at three.
      </p>
      {/* the front-runners, dimmed and verdict-less — small relics awaiting judgment. */}
      <div className="flex items-center justify-center gap-3">
        {contenders.map((c) => (
          <Link
            key={c.postId}
            to={`/p/${c.postId}`}
            aria-label="a contender awaiting the verdict"
            className="block h-20 w-20 overflow-hidden rounded border border-gilt/20 opacity-60 transition hover:opacity-90 sm:h-24 sm:w-24"
          >
            <img
              src={c.media.url}
              alt={c.media.alt ?? ""}
              width={c.media.w}
              height={c.media.h}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </Link>
        ))}
      </div>
    </section>
  )
}
