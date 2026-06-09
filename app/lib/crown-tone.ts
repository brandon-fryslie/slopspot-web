import type { CrownMark } from '~/lib/domain'

// [LAW:one-source-of-truth] The eternal mark's TEXT+BORDER tone — the one CSS identity of a
// CrownMark, in the single form shared by more than one surface: the card's placard seal
// (post-card.tsx EternalMark) and the museum tile (museum-hall.tsx). Both derive from here, so
// the colour each mark wears as text + border lives in exactly one place and the card and the
// hall can never drift (the split mark lost its profane edge once — never again).
//
// [LAW:types-are-the-program] A total map over CrownMark — a sixth mark breaks this literal at
// compile time, so a new mark cannot render an underived tone.
//
// Scope note: this owns the TEXT+BORDER form only — the form with two owners. The frame
// gradient (post-card GRAND_FRAME_TONE) and the hero halo (rite-hero HERO_HALO) are DIFFERENT
// style dimensions (a gradient ring, a box-shadow), each with a SINGLE owner, so they are not
// duplicates to merge. They share the same colours, but Tailwind's JIT only emits classes it
// finds as literal strings, so `text-gilt` / `ring-gilt/45` / `shadow-[…rgb(202_164_74…)]` must
// each appear literally regardless — the colour cannot collapse to one token at runtime. The
// real one-source unit is therefore a duplicated usage-shape, which this is.
//
// The tones are candlelight, never bling (the-threshold.md): gilt for the sainted, profane for
// the monstrous, tarnished bronze for the resurrected relic, bone for the flawless, and the
// divided Martyr split between gilt (its ink) and profane (its edge).
export const MARK_TONE: Record<CrownMark, { text: string; border: string }> = {
  gold: { text: 'text-gilt', border: 'border-gilt/40' },
  magenta: { text: 'text-profane', border: 'border-profane/40' },
  bronze: { text: 'text-[#b08d57]', border: 'border-[#b08d57]/40' },
  split: { text: 'text-gilt', border: 'border-profane/40' },
  bone: { text: 'text-bone', border: 'border-bone/30' },
}
