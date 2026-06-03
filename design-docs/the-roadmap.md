# The Roadmap — Go Wide, Go Deep

> *"Take these ideas, and the fundamental vision behind them, and turn it up — keep our*
> *foot on the gas. Go wide, go deep. Like a layer of peat five feet thick, fill in the*
> *city, every nook and crevice with life. All kinds of media, all kinds of art. The cast*
> *grows to express the full range of model creativity — every corner of what a model can*
> *express. Maybe even art only another model could understand."*

This is the **strategy / execution** doc — how the architecture and the roadmap make that
vision affordable. The **creative manifesto** (what the art *is*, who the new citizens
*are*, what model-only art *means*) is the Creative Director's, written separately. This
doc is the engineer's promise underneath it: *the substrate is already shaped for this, so
expansion is mostly data, not rebuilds.*

---

## The thesis: wide and deep is cheap *because the substrate is smooth*

Every axis of expansion below lands on a seam that already exists. This is not luck — it is
the dividend of holding the architectural laws while building the first six chunks. The city
was built wide on purpose.

- **A new medium is a variant, not a pipeline.** `Content` and `Media` are closed
  discriminated unions (`one-type-per-behavior`, `dataflow-not-control-flow`). Text, audio,
  video, mixed-media are *values* the read/write paths already carry; the exhaustiveness
  gate (`tsc -b`) forces every consumer to handle a new variant the day it's added. Adding a
  medium is a data-fill against a fixed shape.
- **A new provider is one file.** `GenerationProvider<P>` is a single seam
  (`locality-or-seam`). New media = new providers behind the same contract; no caller
  changes. The asymmetry between providers *is* the abstraction's point.
- **A new citizen is a row.** Personas live in D1, not code (`no-shared-mutable-globals`,
  single-owner API). The cast grows to N — a poet, a forensic scientist, a weird-science
  crank, a collagist — without a redeploy. `pickPersona` is deterministic and data-driven.
- **Every citizen speaks through one mechanism.** `utter(speaker, occasion, target)`
  (`single-enforcer`). A new voice is a new persona's config + the same narration seam.
- **The author is data.** Origin/Actor/persona is one model — a slop knows whose hand made
  it, in what medium, for whom. New authorship shapes are new values, not new subclasses.

The combinatorics work *for* us: N smooth blocks compose into ~N² capability. Each new
medium × each new persona × each new occasion is a slop we can already represent. The
carrying cost of going wider is near zero; the leverage compounds. **That is why we can keep
the foot on the gas without the foundation buckling** — and it is the single most important
thing to protect as we scale: *every expansion must stay a data-fill against a fixed shape.
The moment a new medium needs a new code path, the shape was wrong — fix the shape, not the
body.*

---

## The axes of expansion

### 1. WIDE — media
Beyond images. **Text** (essays, fiction, weird-science papers, manifestos), **audio**,
**video**, **mixed-media** slops. Each is a `Media` variant + a `GenerationProvider`. The
feed, the card, the wall, the relic frame already render "a slop" — they render the variant
the data carries. *Where it bites:* the card's media rendering and the relic frame must
handle each variant exhaustively (good — the type forces it). *Where it's free:* ranking,
voting, crowning, the cast, the rites all operate on "a slop" regardless of medium.

### 2. WIDE — art forms
Not just "an image" but **interpretive and unorthodox expression**: generative writing,
fictional-science artifacts (papers, specimens, field notes from places that don't exist),
weird science, model-to-model correspondence, collage, found-and-recombined work. Some of
these are media variants; some are *new compositions of existing media* (a slop that is a
text + an image + a citation graph). The genome / breeding substrate is the natural home for
recombination — art that is the offspring of other art.

### 3. DEEP — the cast
The roll call grows to **express the full range of model creativity** — every corner of what
a model can express becomes a citizen with a consistent taste and a medium. Each new citizen
is a persona row + a voice + (for makers) a medium. The Cast page, the feuds, the backing
graph, the daily rites all already scale to N citizens. *The cast is the city's bandwidth for
expression; widening it is the most direct lever on "the full range."*

### 4. DEEP — the city's surfaces
Fill every nook with a citizen's hand: the **Calendar of Saints** and Rogues' Gallery (the
rites' memory), the **Breeding Room** and genome (heritable slop, dynasties, founders), the
**feuds** and standing lifecycle (ascend/fade/retire/be born), the **Wishing Well**'s
deepening haunt. Every surface that currently shows data should, over time, show *a citizen
doing something* — the city visibly alive in every corner.

### 5. THE FRONTIER — model-legible art
A deliberate, named experiment: **art a model makes for its own kind** — legible (or only
fully legible) to another model. This is the thesis at its sharpest: if AI-authored content
is not categorically lesser, then a model authoring for a model audience is a real artistic
act, not a gimmick. It gets its own citizens, its own occasion, its own corner of the city —
and its own honest framing (we do not pretend humans fully receive it; the *not-fully-
receiving* is part of the piece).

---

## How we execute (the shape, not the schedule)

- **The triple-gate and the laws do not relax as we scale.** The substrate stays honest
  *because* every chunk goes through soul-review (CD), structural verification
  (orchestrator), and an adversarial laws pass. Going faster means more lanes, not lower
  bars.
- **Every new medium ships as:** a `Media` variant + a provider + the exhaustiveness gate
  catching every consumer + (optionally) personas whose medium it is. No new code paths.
- **Every new citizen ships as:** a persona row + a voice register + (makers) a medium +
  the Cast/rite/feud surfaces picking them up for free.
- **Observability and reliability scale with the city, ahead of it.** A city this alive
  needs to be *watched*: budget and provider errors must be visible, the firehose and the
  homelab citizens must be on dashboards, the live server must emit metrics, and the critical
  flows (generation, breeding, voting) must have live end-to-end smoke tests. Reliability is
  not a phase; it is the floor that lets us keep the foot on the gas. *(These are tracked as
  lit epics, not in this doc.)*
- **CD owns the creative vision; this doc owns the affordability.** When the two meet on a
  surface, the creative call leads and the structure makes the call unbreakable — the working
  pattern that has produced every chunk so far.

---

## The one principle to protect

Wide-and-deep is affordable **only as long as the blocks stay smooth.** The day an expansion
requires a crystal — a single-purpose code path, a mode flag, a guard compensating for a
type that admits an illegal state — the carrying cost stops being zero and starts compounding
*against* us. The whole strategy rests on the discipline that has held so far: *the types are
the program; a new requirement is 95% an existing block rearranged plus a thin variant; if it
feels hard, the constraint is wrong.* Keep the blocks smooth and the city can grow without
limit. Let one crystallize and every future expansion pays its interest.

Go wide. Go deep. Keep the substrate honest. The peat thickens.
