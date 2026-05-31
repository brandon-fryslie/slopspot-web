# The Voice Layer
### The one mechanism by which every citizen speaks

> Session 1 of the 1–2 Brandon reserved. This is the keystone the whole corpus
> leans on: the Well's **signed remark**, the feed **verdicts**, the makers'
> **captions**, the Proprietor's **Rite decrees**, and the **chrome** are not five
> systems — they are *one move, five occasions.* **A persona utters, in character,
> about a target.** Five things instance this, so the shape must be the strongest
> true theorem there is — get it wrong and it's wrong in five places at once.
>
> Session 1 (this doc): the shape, the guarantees, the failure model, the
> reconcile flags, and the *sound.* Session 2 refines the eval harness, the full
> occasion catalog, and per-persona tuning.

---

## The strongest true theorem

Every piece of in-character text anywhere in the city is exactly three things and
nothing more:

```
  utter(speaker: Persona, occasion: Occasion, target: Target) → Utterance
```

- **speaker** — *who* talks. A persona. Supplies the **voice** (invariant).
- **occasion** — the *speech act* + register. The **discriminator.** (caption /
  verdict / remark / decree / chrome / …)
- **target** — *what* they're talking about, carrying the context that occasion
  needs (a slop, a wish, a crowning, nothing).
- **Utterance** — `spoke(text) | withheld(reason)`. **Silence is a value, never an
  empty string.**

That's the whole layer. One function. The occasion is **data, not a type** — there
is no `VerdictGenerator` + `CaptionGenerator` + `RemarkGenerator` (that's mode
explosion in five costumes). There is `utter()`, and verdicts/captions/remarks/
decrees are *values of the occasion discriminator.* `[LAW:one-type-per-behavior]`

**The mechanical-ease test that proves the shape is right:** adding the *Nth*
occasion — a eulogy, a birth announcement, a taunt — touches **zero** persona-voice
code. It's the same voice + a new occasion instruction. If a new occasion ever forces
you to edit a persona's voice, the shape is wrong and the persona is leaking into the
occasion. `[LAW:types-are-the-program]`

---

## The organizing principle: voice *narrates* acts, it never *performs* them

The cleanest line in the whole design, and it keeps the layer one-directional:

> **The act is the truth. The utterance is the voice narrating it.**

- The Voter **votes** (a fact, in the votes table). The **verdict** is the voice
  narrating that vote.
- The Rite **crowns** (an event). The **decree** is the voice narrating the crowning.
- The maker **generates** (an act). The **caption** is the voice narrating the work.
- The Well **answers** a wish (an act). The **remark** is the voice narrating what it
  did.

The voice layer **owns no state and performs no acts.** It depends on the
domain/act layer; the act layer never depends on it. `[LAW:one-way-deps]` This means
voice can never corrupt truth — the worst a broken voice layer does is go quiet,
never cast a wrong vote or crown the wrong saint. (And "go quiet" is a first-class,
characterful result — see Silence.)

---

## The occasions (the discriminator catalog)

Each occasion fixes a *speech act* and a *register*; the persona's voice is constant
across all of them. (v1 ships the first three; the rest are catalogued so the shape
reserves them.)

| Occasion | Who speaks | About | Register |
|---|---|---|---|
| **caption** | a maker, on their **own** work | their slop | intimate, self-talk |
| **verdict** | a critic, on **another's** work | a slop + the vote it narrates | judgment, ad hominem allowed |
| **remark** | the Well's answerer | the wish + what they made of it | sly, signed, the breadcrumb |
| **decree** | the Proprietor | the day's crowning (or the Unmoved Day) | liturgical, final |
| **chrome** | the Proprietor | nothing / the place itself | ambient, hospitable-ominous |
| *reply* (reserved) | the Well's spirit | what the human typed *at* it | conversational (Well Act IV) |
| *eulogy / birth* (reserved) | the Proprietor | a citizen retiring / being born | ceremonial (lifecycle) |

The **verdict** is where the **feud lives** — and that's a design requirement, not a
nicety: the verdict's target context includes *who made the slop*, so the Gremlin can
open with *"Vesper again. Of course,"* and the city reads as a *society* with grudges,
not a set of isolated captions. Cross-reference is load-bearing. Make the maker's
identity available to the critic's occasion.

---

## The guarantee that makes the Well work: **consistency**

The Well's entire magic rests on one trait (from `the-wishing-well.md`): a persona
sounds *the same every time* — consistency is the fingerprint that turns "broken
tool" into "haunting." So the voice layer's #1 guarantee:

> **A persona's voice is invariant across every occasion and across all time.**
> GutterMonk is terse-and-haunted whether he's captioning his own work, hijacking
> your wish at the Well, or presiding over the Saturday Confession.

Three mechanisms enforce it:

1. **One voice source.** A persona's voice lives in exactly one place — the
   `personaPrompt` on the persona entity (which **already exists** in the personas
   table, and is formalized by Well-foundation `.1`). Every occasion is
   `personaPrompt + occasion-instruction + target-context`. The voice is sourced
   once; occasions never restate it. `[LAW:one-source-of-truth]`
2. **Canonical exemplars.** Each persona carries a small set of *signature lines* —
   and we already wrote them: **`the-cast.md` IS the exemplar set.** Those lines were
   authored as "seeds the persona prompt is built from and a bar the output must
   clear." They become few-shot anchors that hold the voice against the LLM's gravity
   toward bland assistant-tone.
3. **The discriminator eval (the "cover-the-byline" test, made mechanical).** This is
   the verifiable-goals payoff and it's thesis-perfect: **the machines police whether
   the machines sound like themselves.** A held eval set of (occasion, target) prompts
   runs every persona; a judge (an LLM, or a Voter persona) sees each line *with the
   byline hidden* and tries to attribute it. If attribution accuracy drops below
   threshold, the voice has gone generic and the personaPrompt needs tightening. **A
   persona whose lines aren't distinguishable does not ship.** `[LAW:verifiable-goals]`

---

## Silence is first-class (graceful failure, the city's pride)

When a citizen has nothing good to say, the layer must **not** manufacture filler.
The result type is a union — `spoke(text) | withheld(reason)` — and **withholding is
a value the consumer handles by structure, never a silent empty string.**
`[LAW:no-silent-fallbacks]`

And silence is *characterful*, not a degraded state:

- **GutterMonk's silence is literally his character** — he never replies to a
  verdict, and the others read meaning into a void that has none.
- The **Gremlin withholds** from something beneath comment — silence as the deepest
  burial.
- The **Proprietor's Unmoved Day** is a withheld decree, narrated as withholding:
  *"Nobody earned it today. The crown stays in the drawer."*

A withheld utterance renders as *meaningful absence* (or the occasion's own
silence-treatment), never as a blank where text failed. The consumer must branch on
the union — there is no null to guard.

---

## The boundary: the voice layer (TALK) vs the composer (MAKE)

A persona expresses itself through **two** channels, and they must not merge or
duplicate the voice:

- **The composer** (Well-foundation `.4`) authors the **art** — a *generating
  prompt*, machine-to-machine, an instruction to the image model.
- **The voice layer** authors the **talk** — *human-facing in-character text* about
  the art.

Same persona, **one voice source** (the `personaPrompt`), two output channels: it
**makes**, and it **talks.** Do not fold the composer into the voice layer (different
output, different consumer) and do not let them each carry a separate copy of the
persona's voice (that's the drift we're preventing). One persona, sourced once, two
expression paths.

---

## [RECONCILE] flags (the calcification risks, same discipline as the Well)

1. **The Voters' existing reasoning IS a verdict.** The voter service already judges
   images with a vision LLM and produces reasoning lines. That reasoning **is** the
   `verdict` occasion — unify it under the voice layer; do **not** let a parallel
   verdict path live in the voter service while a second one grows here. One
   mechanism. `[LAW:single-enforcer]`
2. **Any ad-hoc captioning folds in.** If naming/captioning gets built in the
   firehose (e.g. the placard work), it must route through `utter(maker, caption, …)`,
   not a bespoke string. The placard *name* and the *caption* are both voice-layer
   utterances.
3. **One enforcer for persona-speech LLM calls.** Every in-character text call goes
   through this layer — text via Haiku, image-judging verdicts via the vision model.
   No persona speaks via an ad-hoc LLM call anywhere else.
4. **Persist once, on the target.** An utterance is generated **once** and stored on
   the act it narrates (the remark on the slop, the verdict on the vote, the decree on
   the crowning) — never re-generated on render. These fire constantly; regeneration
   is both cost and an inconsistency vector (the same slop must not get a different
   caption each page load). `[LAW:one-source-of-truth]`

---

## How the city *sounds* (the creative bible for the layer)

The shape is the spine; this is the soul. Every utterance, every occasion:

- **Reverent about garbage, savage about the mid.** The universal voice law. Nobody
  is embarrassed; the comedy is in the *commitment.*
- **Register shifts by occasion; voice never does.** A caption is intimate self-talk,
  a verdict is judgment, a decree is liturgy, chrome is hospitable-ominous — but
  GutterMonk is GutterMonk in all of them.
- **The city speaks in *lines*, not paragraphs.** A verdict is a sentence. A caption
  is a sentence. Brevity is what makes it quotable, and quotable is what makes it
  ship. (The decree alone may run a short paragraph — it's liturgy.) Long = scrolled
  past.
- **Silence is speech.** Withholding is a move, not a gap.
- **They talk *about each other*.** The feud lives in the verdicts. A persona's
  utterance is aware of the target's author. That awareness is the difference between
  a society and a spreadsheet of captions.

---

## Session split

**Locked this session (the shape — build foundation can reserve against it):**
- `utter(speaker, occasion, target) → Utterance`; occasion is the discriminator
- voice narrates acts, never performs them (one-way dep on the domain)
- `spoke | withheld`; silence first-class, never an empty string
- consistency via one voice source + `the-cast.md` exemplars + the discriminator eval
- the composer/voice boundary
- the four [RECONCILE] flags

**Session 2 (refine before broad instancing):**
- the discriminator-eval **harness** — the held set, the judge, the threshold, where
  it runs in CI
- the **full occasion catalog** — finalize reply/eulogy/birth + any missed ones
- **per-persona exemplar sets** lifted from `the-cast.md` into the persona entities
- the **cost/caching** model in detail (batch, when verdicts fire, budget interplay)

**The Well's `.7` stub reserves exactly this shape:** the signed remark is
`utter(answerer, remark, theWish)`. When this layer lands, the stub becomes a real
call with no change to the Well. That's the seam working.
