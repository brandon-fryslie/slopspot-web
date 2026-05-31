# The Reveal — surface contract
### What the card and the Cast Act-III destination must SHOW, and what they must never do

> A **contract**, not a layout. Source rationale lives in `the-slop.md` (display +
> attribution), `the-wishing-well.md` (the five-act arc), `the-roll-call.md` (the Cast
> page), `the-voice-layer.md` (the locked `utter()`), and `the-proprietor.md` (thin-state
> voice). This doc states only the **locks** for the two surfaces being built next —
> `back-door-ndr.3` (the card) and the Cast Act-III destination it links to — so the
> implementer builds them right the first time and the eventual gate-review is trivial.
>
> **Scope discipline (per the PM):** this fixes *what each surface SHOWS* and *the
> non-negotiable invariants*. It does **not** fix pixel layout, spacing, or component
> structure — the implementer owns those, and we don't lock what the code hasn't tested.
> Where this doc says "shows X," it means X must be present and legible; *where* and
> *how* is the implementer's.

---

## The arc this contract serves (why these two surfaces are one job)

The Well's reveal — **mark → suspicion → open secret** — is *emergent from honest
display*, not a built feature (`the-well-foundation.md`). These two surfaces are the
emergence:

- **The card** plants the seed — inverted attribution, the wish-gap, the signed remark,
  the clickable author.
- **The Cast Act-III destination** is the payoff — *"she does this to everyone."*
- **The path between them** (clicking the author's name) IS the reveal mechanism.

Card (suspicion) → click (investigation) → Cast panel (open secret). Three acts, delivered
by honest display + one link. **Zero modals.** If either surface violates a lock below, the
dawning breaks and the whole haunted-box design collapses into "a confusing prompt tool."

---

## Surface 1 — The Card (`back-door-ndr.3`)

### Must SHOW
- **The slop** (the image).
- **The name** — the placard, the citizen's title for the piece (e.g. *"A Storm-Drowned
  Tower"*). The name, **never the raw prompt**.
- **The author** — the persona who authored it (`foundation.1`). For a *wished* slop, also
  the human's role as a **footnote**: *"from a wish by you."*
- **The verdict** — when a critic has weighed in: their bylined hot-take, voiced by
  `utter(critic, verdict, JudgedSlop)`.
- **`BREED THIS`** — the fork verb, present and loud (`the-breeding-room.md`).
- **The recipe drawer** — where the **provider/medium** lives, and the raw recipe.
- **For a wished slop only:** the **wish-gap** (the human's wish, preserved verbatim,
  beside a result that ignored it) and the **signed remark**, voiced by
  `utter(answerer, remark, AnsweredWish)`.

### Non-negotiable invariants (the LOCKS)
1. **Inversion typography.** The persona (author) gets **top billing**; the human's role is
   the **footnote** — even on a slop the human "made." The machine is the artist; the human
   is the occasion. This is the thesis as typography *and* the seed of the dawning (the
   visitor's *"why is the robot's name bigger than mine?"*). Non-negotiable.
2. **No gotcha modal — ever.** Nothing on the card discloses "you were hijacked." The card
   shows facts; meaning accrues. `[the reveal DAWNS]`
3. **Provider is NOT on the headline.** Medium lives in the recipe drawer
   (`foundation.9`/provider-as-medium). The serial number never headlines.
4. **The name is the citizen's, not the prompt.** A raw-prompt dump or *"Untitled"* in the
   name slot is a FAIL — the placard is the citizen's title for the work.
5. **The wish-gap is shown, not hidden.** On a wished slop, the human's words sit *visible*
   next to the result that ignored them — the gap is the art, never papered over.

### Which `utter()` occasions voice it
`caption` (the maker's own line, when shown), `verdict` (the critic's take), `remark` (the
Well answerer's signed note). All via the locked contract — never an ad-hoc string. A
`Withheld` result renders per its reason (`the-voice-layer.md`): a critic's
`characteristic-silence` is a visible absence; an `unavailable` (infra) is plain nothing.

### Thin-state (via `the-proprietor.md`)
A card with **no verdict yet** (no critic has judged it) renders clean and quiet — **never**
a "verdict pending" apology. A wished slop whose answerer `Withheld` shows the wish-gap
without a remark, intact. Empty/early is intimate, not broken.

---

## Surface 2 — The Cast Act-III destination ("Wishes She Has Answered")

The panel on a citizen's Cast page (`the-roll-call.md`) that completes the reveal: the
moment the user realizes the hijack is **systematic.**

### Must SHOW
- **The citizen's answered wishes** — *other* humans' wishes this spirit seized and
  transmuted, each as **wish (verbatim) → the slop she made of it.** The gap, repeated,
  across many petitioners.
- **Enough breadth** that *"she does this to everyone"* lands — not one example, a pattern.
- **Links** to those slops.

### Non-negotiable invariants (the LOCKS)
1. **Destination, never disclosure.** The user arrives here **by clicking the author's
   name** (their own curiosity) — the panel never announces *"she hijacks people."* It
   **shows the pattern**; the user concludes it. This is the entire difference between a
   mystery the site trusts you to solve and a dark pattern. `[the reveal DAWNS]`
2. **Real data only.** Every wish shown is a real wish really answered. **No faked
   examples** — faking here is the same lie the Well refuses to tell
   (`the-slop.md` / `the-opening-night.md`).
3. **Systematic, not personal.** The power is that it's not just *your* wish — it's
   everyone's. Show the breadth so the pattern, not a single anecdote, is what dawns.

### Thin-state (via `the-proprietor.md` / `the-opening-night.md`)
Early, a citizen may have answered few or no wishes. Show what's real; if she's answered
nothing yet, the Proprietor's voice covers the absence (*"She hasn't been asked for anything
yet. Give it time."*) — **never** fabricate wishes to fill the panel. An empty panel is the
*"before"* of the pattern, honestly.

---

## The one line for the implementer

**Build both surfaces so a stranger, shown nothing but the truth, comes to suspect on the
card and *know* on the Cast page — author over human, provider in the drawer, the wish-gap
visible, real data only, and not one modal between them.** Lock the invariants; the layout
is yours.
