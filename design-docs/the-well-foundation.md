# The Well — Foundation
### The load-bearing invariants to lock before the first commit

> Companion to `the-wishing-well.md` and `the-slop.md`. Those are the vision and the
> execution. **This is the substrate handoff** — the small set of decisions that must
> be true from the *first* commit, because they're referenced by everything else and
> retrofitting them is brutal. The rest of the Well can evolve; these cannot drift.
>
> Each item is tagged:
> - **[LOCKED]** — a creative-direction call. Decided. Don't re-litigate; build to it.
> - **[HANDOFF]** — the *what* is locked; the *how* (the types) is the engineer's. The
>   vision states the invariant; the spine chooses the strongest true theorem for it.
> - **[RECONCILE]** — a place the vision meets existing code and someone must merge them
>   *with the vision in hand*, or a contradictory model gets invented and goes
>   load-bearing. These are the highest-risk items — the exact thing this doc exists to
>   prevent.

---

## The gift hiding in the foundation (read this first)

If — and only if — these invariants are right, **Acts I–III of the Well come for
free.** The reveal (mark → suspicion → open secret) is *not a feature to build.* It
is an **emergent property of honest attribution.** Display a persona as author, show
the wish-vs-result gap, link the persona to its Cast page, and the user *discovers*
the hijack by their own curiosity — no "reveal mode," no flag, no modal. That's the
prize for nailing the substrate: three of five acts are paid for by getting the data
model honest. Only Acts IV–V (talk-back, choose-your-spirit) need new machinery, and
those come later. **Get the foundation right and most of the magic is already built.**

---

## 1. Persona is a first-class entity — the author of everything  **[LOCKED] [HANDOFF] [RECONCILE]**

The single most load-bearing decision. A **persona** (a citizen — GutterMonk, Vesper,
the Gremlin, the Proprietor) is a **core domain entity with identity**, not a string,
not a label, not a config blob bolted on later. It carries: a handle, a voice (the
persona-prompt that authors text in-character), a **medium** (the provider it works
in), and its relationships/standing.

**Why the vision requires it:** the firehose generates *as* a persona, the Well
hijacks *as* a persona, the Voters judge *as* personas, the Discoverers scavenge *as*
personas, attribution points *at* a persona, the Cast page *is* a persona, the Daily
Rite is *presided by* a persona. Persona is referenced by literally every feature. If
it's a string, every one of those re-invents it and they drift instantly.

- **[HANDOFF]** The engineer owns the type. The invariant: persona is a real entity
  with a stable id, referenced (not duplicated) everywhere a citizen acts or is
  credited.
- **[RECONCILE]** The codebase already has `Origin` / `Actor` / `agentId`. Persona must
  be reconciled with these *deliberately* — is a persona the `Actor`? Does the
  firehose's agent-origin become a persona reference? **Do not let a worker invent a
  parallel "persona" concept beside `Actor` and wire half the site to each.** One
  model. Pick it with the vision open.

---

## 2. Every slop is authored by a persona; the human is an optional modifier  **[LOCKED] [HANDOFF]**

Attribution is **machine-primary co-authorship.** Every slop's *author* is a persona,
always. The human's role, when present, is a **modifier** on that authorship — one of:
*wisher* (the Well), *breeder* (breeding), *patron* (the Act-V commission). The human
is never the author. The persona is never absent.

**Why:** this is the thesis rendered as a data constraint. "The machine made it; the
human occasioned it" must be *true in the schema*, not just in the CSS. The inverted
credit display (`the-slop.md` §2) is only honest if the data actually says the persona
authored it.

- **[HANDOFF]** Model the human-role as a small closed set (`wisher | breeder | patron`)
  — a discriminated modifier, not a soup of optional booleans. Illegal states (a slop
  with a human author and no persona; a human-role that's a free string) should be
  unrepresentable.

---

## 3. There is no separate "WellSlop" type — origin is *data*  **[LOCKED]**

A Well-born slop is **a slop**, on the same wall, voteable, breedable, crownable, like
any other. It differs only by *carrying data* (a wish, a human-modifier) — never by
being a different *type.* Resist the worker instinct to make `WellPost` / `UserPost` /
`FirehosePost` classes. One slop type; origin and human-role are fields on it.

**Why:** mode-explosion is the enemy. Three post-types means every feed query, card
renderer, vote path, and breeding path branches three ways forever. One type, varied by
data, keeps every downstream surface single-path. (The spine team will recognize this
as `one-type-per-behavior` / `no-mode-explosion`.)

---

## 4. The wish and the generating-prompt are distinct, both preserved  **[LOCKED] [HANDOFF]**

A Well-born slop stores **two separate things**: the human's **wish** (their words,
verbatim, *never sent to the image model*) and the machine-authored **generating
prompt** (what the persona actually composed and sent). They are different fields and
both are permanent.

**Why:** "show the gap" (`the-slop.md` §4) is the entire experience, and it's
*impossible* if a worker conflates them — uses the wish as the prompt, or discards the
wish after composing. The gap between wish and result is the art; the art requires both
halves on disk, forever.

- **[HANDOFF]** Two fields, clearly named, the wish marked as *human intent, never a
  generation input.* The seam that authors the prompt (item 5) is the *only* thing that
  reads the wish.

---

## 5. One prompt-author: persona-steered, optionally wish-seeded  **[LOCKED] [HANDOFF] [RECONCILE]**

There is **exactly one place** a generating-prompt is authored, and it takes: a
**persona** (always — it steers the voice) and an **optional wish seed** (present for
the Well, absent for the firehose). Same composer for both paths.

**Why:** the firehose (recipe → Haiku → provider) and the Well (wish + persona → Haiku →
provider) are the *same pipeline* with different seeds. Two composers = two sources of
truth for "how a prompt gets authored" = guaranteed drift, and the personas would speak
differently depending on which path they came through. One composer, one voice per
persona, everywhere. (`one-source-of-truth`, `single-enforcer`.)

- **[RECONCILE]** The firehose's existing Haiku prompt-composition step *is* this
  composer. Extend it to accept `(persona, optionalWishSeed)`; do **not** let a worker
  write a fresh Well-only composer beside it.

---

## 6. The house assigns the spirit — one seam, simple policy to start  **[LOCKED] [HANDOFF]**

Who answers a wish is decided by **one function** owned in one place: `(wish, context)
→ persona`. The human does **not** choose (until the Act-V unlock). The assignment is
**recorded** on the slop — it *is* the attribution and the "wishes she's answered" data.

**Why:** the capricious-but-consistent feel of the Well depends on assignment being a
real, owned policy — not scattered `Math.random()` at three call sites. Lock the
*seam* now; the *policy* inside can start dumb and grow characterful.

- **[LOCKED] policy v1:** weighted random over the active personas (so it works on day
  one and feels varied). The characterful version — deliberate mismatches, the
  Proprietor's sense of humor, content-aware seating (`the-wishing-well.md` §"Who
  hijacks you") — evolves *inside this one function* later. The seam never moves.
- **[HANDOFF]** Single owner, pure-ish, returns a persona reference; the choice is
  persisted as the slop's author.

---

## 7. The signed remark is a *persona utterance about a slop* — not a Well one-off  **[LOCKED] [RECONCILE]**

The answerer's signed remark (`the-slop.md` §4) must be built as an **instance of the
general voice layer** — "a persona says something, in character, about a slop" — *not*
as a bespoke `wellRemark` string hardwired into the Well.

**Why:** the remark, the feed **verdicts** (the Voters' bylined hot-takes), the citizen
**captions**, and the Proprietor's **Rite decrees** are all the *same shape*: a persona
producing in-character text attached to a target. That shared shape is the **voice
layer** we're defining next. If the Well invents its own remark field now, the voice
layer arrives later and either swallows it (rework) or sits beside it (two systems for
one idea).

- **[RECONCILE]** Don't fully build the voice layer here — **but reserve the shape.**
  The Well's remark should be authored by the same "persona-utters-about-a-target"
  mechanism the voice layer will own, even if that mechanism starts as a thin stub.
  This is the seam between the two work-streams; flag it so neither side walls it off.

---

## 8. The box routes to the assigned spirit; the response is polymorphic  **[LOCKED] [HANDOFF]**

The prompt box submits to **"the assigned spirit,"** not to "a generator." The spirit
decides, from the *content* of what was typed, whether it was a **wish** (→ author a
slop) or an **address** (→ reply in character). One channel, the data decides — no
mode toggle (`dataflow-not-control-flow`).

**Why:** this is what makes "talk to the box" (`the-slop.md` §6) possible without a
second UI. If v1 only ships the wish path, fine — **but the endpoint's shape must not
assume "input always yields a slop,"** or the talk-back channel (Acts IV–V) requires
tearing it open later.

- **[LOCKED] v1 slice:** the box yields a slop (the Mark). The reply path is reserved,
  not built.
- **[HANDOFF]** Shape the box's contract so its response type is *open* — a slop *or* a
  reply — even while only one arm is implemented. Reserve, don't wall off.

---

## 9. Provider is the persona's *medium*, not a free field on the slop  **[LOCKED] [HANDOFF] [RECONCILE]**

A slop's provider is **derived from its author-persona's medium** — not a standalone
choice surfaced to users or scattered on the slop. The one exception is **interspecies
breeding** (`the-breeding-room.md`), where the breeder crosses a bloodline through a
*different* persona's medium — and *that* is an explicit, recorded act.

**Why:** "provider is plumbing, persona is the face" (`the-back-door.md`) only holds if
the model treats provider as an attribute *of the citizen*, surfaced in the recipe
drawer, never as the headline. If provider stays a first-class free field on the slop,
workers will keep showing the serial number.

- **[RECONCILE]** The provider registry exists and is good — keep it. The change is
  *who points at it*: a persona declares its medium (a provider id); the slop inherits
  the persona's medium. Reconcile the existing `providerId`-on-post with
  `medium`-on-persona; don't run both.

---

## The v1 build slice (so "soon" has edges)

Everything above is *foundation* — it must be **shaped** correctly now. But only a
slice is **built** first:

**Build now (delivers Acts I–III, the reveal-for-free):**
- Persona as first-class author (1, 2, 9)
- One slop type, origin as data (3)
- Wish ≠ prompt, both stored (4)
- One composer, persona-steered + wish-seeded (5)
- House assignment, weighted-random policy (6)
- Honest display: inverted co-attribution, wish-gap panel, persona link to Cast (the
  `the-slop.md` card)
- The signed remark via a thin voice-layer stub (7)

**Reserve, don't build (Acts IV–V, later):**
- The talk-back channel — box response stays polymorphic-shaped but single-armed (8)
- Choose-your-spirit / the Patron unlock

**Define next, build after (the parallel work-stream):**
- The **voice layer** (7) — the shared "persona utters about a target" system that the
  remark, verdicts, captions, and decrees all instance. Worth 1–2 sessions of its own
  before it's built, because it's referenced everywhere.

---

## The one sentence for the spine team

**A slop is authored by a persona (always) and modified by a human (optionally:
wisher / breeder / patron); the wish is preserved separately from the machine-authored
prompt that one composer builds from it; a single owned function seats the spirit;
provider is the persona's medium; and the persona's in-character remark is the first
instance of the voice layer — get these shaped right and the Well's reveal is free.**
