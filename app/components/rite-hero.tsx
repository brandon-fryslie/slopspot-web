import type { Crowning, CrownMark, RenderablePost } from "~/lib/domain"
import { CrownedPostCard } from "~/components/post-card"

// [LAW:types-are-the-program] The hero is a RenderablePost that IS crowned — the
// `crowning` RenderablePost leaves optional is REQUIRED here, so "a hero with no crown
// to colour it" is unrepresentable. The home loader narrows by the value (a crown exists
// or it does not); past that narrowing the mark is always in hand.
export type CrownedRenderable = RenderablePost & { crowning: Crowning }

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
// The hero owns SIZE (a wide, centred measure) + the crown's own halo; the card owns the
// grand frame and the canonization seal — the hero never rings the card itself.
// [LAW:dataflow-not-control-flow] The crown's PRESENCE is the discriminator: a null hero
// (no crown settled, or none resolved) renders nothing, a present one renders the relic.
// The home page calls this UNCONDITIONALLY and lets the value decide — no caller-side guard
// gates whether the hero exists; the null flows in and out as the empty render.
export function RiteHero({ hero }: { hero: CrownedRenderable | null }) {
  if (hero === null) return null
  return (
    <section aria-label="the city's standing crown" className="mx-auto mb-12 max-w-3xl px-4">
      <p className="mb-3 text-center font-terminal text-[11px] uppercase tracking-[0.3em] text-ash">
        ·· today&apos;s rite · presided by{" "}
        <span className="text-bone/70">{hero.crowning.presiding.displayName}</span> ··
      </p>
      <div className={`rounded-lg ${HERO_HALO[hero.crowning.mark]}`}>
        <CrownedPostCard {...hero} mark={hero.crowning.mark} />
      </div>
    </section>
  )
}
