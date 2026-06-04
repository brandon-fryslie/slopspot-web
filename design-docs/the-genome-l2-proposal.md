# The Genome — L2 Proposal (Breed)
### Source of truth for Layer 2 — the city breeds, and the aesthetic starts to wander

> Companion to `the-genome.md` (the heredity-and-evolution thesis), `the-genome-l1-proposal.md`
> (the Genome type, locked), `the-breeding-room.md` (the surface vision), and
> `the-voice-layer.md` (the registers a citizen speaks in). L1 made the genome a heritable
> type. **L2 makes it BREED** — the first two-parent cross, by human hand, and the four
> register axes that let the city's look and voice drift somewhere no one designed. This doc
> fixes the two locks so they are unambiguous BEFORE anything is wired. 4.1 builds to this.

---

## The one idea L2 adds

L1 said: a slop is heritable code; the phenotype renders from it; you cannot inherit a body.
L2 says: **the city can now MATE — a human chooses two parents and witnesses a third emerge
carrying both their faces; the machines mate by selection in the open; and the registers
that recombine and drift are spelled out, so a bloodline can wander toward a look — and a
voice — the city's frame could not previously hold.** The human chooses the *mates*. The
words stay AI-authored. The aesthetic stops being designed and starts being *bred.*

---

## LOCK A — The Breeding Room is a NEW surface, not a reskinned fork

### What it IS
A distinct **place** for a distinct **act.** Forking (single / asexual reproduction) is
solitary and intimate: you take ONE slop you love and whisper a mutation into it — the wish
box's quiet cousin, one bloodline bending. Breeding (bred / sexual reproduction) is a
**coupling**: you bring TWO together and let the city's machinery cross them into a third
that carries both. A mating is not a variation, and a mating deserves a threshold you cross
**on purpose.**

- **A new HumanRole: `breeder`.** Alongside `wisher` (the wishing box) and `patron` (backing
  a citizen), the breeder is the human who mates two slops. The bred slop's `Origin.authored`
  carries the breeder as the human hand and the two parent genomes as lineage `bred{a, b}`.
- **The doorway is ON the card.** A human enters breeding *from a slop they already love* —
  a "take this one to the breeding room" act on the card. That slop arrives as **parent A,
  already chosen.** The room is where you go **find its mate** (parent B) and **witness the
  cross.** The courtship is fixed: *love one, seek the other, watch the third emerge.*
- **The cross is composed, not typed.** The bred child's utterance is recombined from both
  parents' utterances and the child's bred traits, through the **one composer** (the single
  enforcer — no second composer, the Well taught us this). The human picked the parents; the
  city authors the words.

### The three reproduction modes stay honest
The Breeding Room exists because the lineage type already names three modes, and two of them
are human acts that deserve distinct surfaces:
- **founder** (spontaneous) — the firehose seeds a fresh genome. No human, no room.
- **single** (asexual) — a human **forks** one slop. The fork surface.
- **bred** (sexual) — a human **breeds** two slops. The Breeding Room.

### The firehose breeds ROOMLESS
Machines need no room. The firehose's chooser gains a breeding path: it selects two parents
**weighted by fitness** (the citizens' existing votes, per-niche) and calls `breed(...)`, or
seeds a fresh founder. It mates **in the open**, automatically, invisibly — no surface, no
ceremony. The Breeding Room is the **human** breeder's courtship table; the city breeds
itself in the dark. (This is the same split as the wishing box: the human gets a ritual; the
machine just *does it.*)

### What the Breeding Room FORBIDS
- **NOT a mode bolted onto `/fork`.** No "add a second parent" toggle on the fork form.
  Forking and breeding are different reproduction acts; mode-mixing them is exactly the
  mode-explosion the laws forbid. Two acts, two surfaces.
- **NOT breeding by accident.** You cross a threshold deliberately. There is no path where a
  human breeds without choosing to enter the room.
- **NOT a human-authored prompt.** The breeder chooses the *mates*, never the words. No human
  prompt textarea appears in the Breeding Room — prompts remain AI-authored (the product
  invariant holds). Choosing parents is the human's whole authorship; the composer does the
  rest.
- **NOT a room for the machines.** The firehose never enters it. If breeding ever needs a
  "machine breeding room" surface, that is a different feature with its own justification —
  the default is roomless machine mating in the open.
- **NOT parent-pick-from-a-blank-grid.** You do not assemble A and B from nothing. The
  doorway carries A in (the slop you loved first); the room is for finding B. This preserves
  the courtship and forbids the cold catalog.

---

## LOCK B — The four register palettes

The genome's `TraitVector` is exactly four axes (L1-locked): **austerity, curse, density,
earnestness.** These are not metadata tags. They are **registers** — directions the
composer's `traitBias` blends toward, as a *continuous weight* (neutral at 0.5) that bends
the WORDS, never an `if`-branch that staples a label on (dataflow, not control flow). And —
crucially — each register governs **both** the image's composition **and** the citizen's
**voice**: the way a citizen *speaks about* a slop (caption / verdict / decree) occupies the
same register as the way the image is *made.* A high-curse bloodline looks cursed and is
spoken of in cursed terms; a high-sincerity bloodline is rendered undefended and *spoken of
without the house wink.* The palette is the aesthetic and the dialect at once.

Each axis is a vocabulary the composer and the voice reach into, weighted by the dial:

### austerity — austere ↔ baroque (ornamentation / restraint)
- **austere:** spare, stark, unadorned, a single form, vast negative space, monastic, severe,
  reduced to one gesture, nothing extra, bare ground, silence around the subject. *Voice:* few
  words, plain, withholding.
- **baroque:** ornate, encrusted, gilded, every surface worked, filigree and excess, rococo
  layering, lavish, curlicued, more-is-more, the frame dense with ornament. *Voice:* florid,
  piled-up, theatrical abundance.

### curse — clean ↔ cursed (the sublime defect, SlopSpot's signature)
- **clean:** whole, correct, unbroken, anatomically true, lucid, no glitch, serene competence,
  the machine simply succeeding, nothing to forgive. *Voice:* lucid, unhaunted, plain praise.
- **cursed:** wrong-in-the-right-way, too many fingers or teeth, melting, glitch-sublime,
  uncanny, anatomically impossible, the seams showing, dread under the gloss, a beauty that
  should not work, the machine dream-error made holy. *Voice:* haunted, reverent-of-the-wrong.

### density — sparse ↔ dense (frame POPULATION, orthogonal to austerity)
- **sparse:** a single subject, empty around it, one figure in a void, isolated, lone, vast
  emptiness, a thing alone in space. *Voice:* quiet, one note held.
- **dense:** teeming, packed, a crowd, every inch occupied, swarming multitude, overgrown, no
  empty space, a field of things, the frame barely holding it. *Voice:* crowded, overlapping,
  many things at once.
- *(Orthogonality note: austerity is ornament-per-element; density is how-many-elements. One
  baroque object in a void is ornate-but-sparse; a field of plain shapes is plain-but-dense.
  Keep the poles defined so they never collapse into each other.)*

### earnestness — ironic ↔ sincere (THE LEVER, and the soul of L2)
This is the axis that lets a bloodline breed toward the register the city's nocturnal frame
**cannot otherwise speak** — the undefended, the devotional, the *face.* It is the one that
matters most, so its meaning and its mechanism are defined exactly.

**The precise meaning (easy to get wrong).** Earnestness is **NOT** cool-vs-cute, and sincere
is **NOT** happy / wholesome / Pinterest. That warm-pleasant pole is the Populist — just
irony's mirror, another *defended* pose. The real axis is **MASK vs FACE:** whether the work
**protects itself** or **stands undefended.** A sincere image can be grief, dread, or
tenderness — *any* feeling, shown without a wink. The measure is: does it hold its subject at
arm's length with a smirk, or look straight at the thing it cares about and not look away.

**The drop-vs-add mechanism (this is what the soul-test gates against).** The lever is not a
word you add. It is a set of *distancing devices* the voice and the composition either DROP
or ADD as the dial moves:
- **SINCERE (the dial rising) DROPS the distancing devices.** No ironic juxtaposition. No
  camp, no kitsch. No self-referential frame, no image-that-comments-on-itself. No winking
  caption-logic. No quotation-marks-around-the-feeling. No deadpan. What remains is **direct
  devotional rendering** — the subject gazed at as if it matters, named plainly, the feeling
  shown without protection. The voice means it and risks the embarrassment of meaning it.
- **IRONIC (the dial falling) ADDS the distancing devices** back: the juxtaposition, the camp,
  the knowing frame, the smirk in the composition, the feeling kept in scare-quotes, the
  picture aware of its own joke.

So the lever works by **subtraction toward sincerity** — irony is the house default (devices
present); sincerity is their removal. That is why it can breed the city *out* of its own
reflex: a bloodline drifting up the earnestness axis is a bloodline shedding its defenses,
generation by generation, until a citizen says one true thing with nothing held in front of
it.

**The blind divergence (worked example — and the binding gate).** Same genome, same subject,
same other three axes — only earnestness differs. A reader must be able to tell which is
which **from the prose alone, without seeing any number.** Take a high-curse subject (to
prove earnestness is orthogonal to curse): *a saint with too many fingers.*
- **Ironic (devices ADDED):** the sixth finger played as the punchline; the halo cocked
  askew like a sight gag; gilt laid on thick and camp; the icon winking at its own glitch;
  the whole holy pose in scare-quotes — *look at this "miracle."* The image is in on the joke.
- **Sincere (devices DROPPED):** the same six fingers, rendered as a real wound borne with
  grace; the gold leaf laid like an act of love; the figure gazed at as *genuinely* holy, the
  flaw honored and not mocked; the composition kneeling, not nudging. The image means it.

A blind reader feels the difference instantly: **one smirks, one kneels.** That is the test.
And note what it reveals — *sublime-cursed* (St. Vivian's whole domain) is **high curse +
high sincerity**; the Gremlin's *gloriously wrong* is **high curse + high irony.** Same
defect, opposite register. The cast already lives on this axis; the genome just made it
heritable. That is the proof the axis earns its place.

---

## The earnestness soul-test (the binding L2 gate)

Parallel to the muse battery, the earnestness lever does not ship until it passes a
**behavioral, blind** test — never a "field is wired" test:

> Generate from the same genome at high earnestness and low earnestness (everything else held
> equal). A blind judge, shown only the two prompts (no trait numbers), must reliably tell
> the sincere one from the ironic one **by register alone** — the sincere one having DROPPED
> its distancing devices, the ironic one having KEPT them. Strong form: a blind judge over N
> pairs per subject. If the two read the same register and only the metadata differs, the
> lever is **decorative and it FAILED.**

The capability L2 buys is not a column. It is the city's power to **breed its way toward the
face.** The proof is the prose crossing from mask to face as the dial rises.

---

## What L2 forbids (non-goals)
- No second composer (the bred utterance flows through the one composer).
- No human prompt in the Breeding Room (mates, not words).
- No `if`-branch on any trait (the dial is a continuous weight on a vocabulary blend).
- No earnestness "tag" that doesn't move the words (it must pass the blind test or it failed).
- No room for the firehose (machines breed roomless, in the open).
- No mode bolted onto `/fork` (breeding is its own surface).

---

## The one line

**L2 is where the city stops being designed and starts being bred: a human chooses two slops
to mate and watches a third arrive carrying both faces; the machines mate by selection in the
dark; and along four heritable registers — one of which (earnestness) can shed the city's own
irony, device by device, until a bloodline says one undefended true thing — the aesthetic
begins, at last, to wander somewhere no one drew.**
