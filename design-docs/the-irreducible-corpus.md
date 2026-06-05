# The Irreducible Corpus
### Roadmap horizon — meaning as a function of the whole corpus, not the single piece

> Brandon's direct vision drop (2026-06-05). Six systems — some structural, some texture —
> bound by one principle. Captured by the orchestrator while the fleet was spend-paused; CD (2.1)
> refines into ranked children when the fleet resumes. **Pull on whichever catch; the spread is
> deliberate, not a committed sequence.** These compose on what is already built (the genome DAG,
> the voice layer, the personas/critics, the daily-rite/calendar) — never a parallel model.

---

## The unifying principle (the thesis, stated as a law)

**Make meaning a function of the WHOLE corpus, not the single piece.** That is the only way to get
true *irreducibility*: when no artifact is fully legible without the thousand around it, and the
relationships keep mutating, the peeling never bottoms out. A single deep image can be exhausted;
an evolving system of cross-referencing, self-contradicting, half-buried strata cannot.

Architecturally this is `one-source-of-truth` taken to its limit — *derive, never cache.* Every
system below makes some quantity (a critic's stance, a rite's timing, a piece's meaning, the true
lineage) a **live fold over the corpus**, not a stored property. Irreducibility is the emergent
consequence of nothing being cacheable: you must re-derive from everything, every time. Build each
system as a fold over the existing single sources (the lineage DAG, the utterances store, the
persona/verdict history) and the irreducibility comes for free; store a shortcut and you have
flattened the very thing that makes the corpus deep.

---

## The six systems (abstraction first; Brandon's illustration kept as the proof-of-feel)

### 1. Critic memory & drift — critics accumulate, contradict, and reckon
**Abstraction:** a critic's position is **stateful and derived from its ordered verdict history**,
not a fixed config. The state *erodes and calcifies* over the corpus, so the only way to fully read
a critic is to read everything it has ever said, in order. [LAW:one-source-of-truth] the verdict
history (the `utterances`/votes a critic has authored) IS the position — the "current stance" is a
recency-weighted fold over it (compose on `app/lib/character.ts` `accreteCharacter` + the voice
layer), never a separately-stored mutable mood [no-shared-mutable-globals].
**Brandon's feel:** St. Vivian remembers what she blessed last month and starts contradicting her
past self, then must reckon with it in a later verdict. The Gremlin develops a specific, petty
grudge against one artist whose work he can't stop burying — and the grudge becomes legible to a
careful reader *before it is ever stated.*
**Gate:** a critic's verdict on a piece provably depends on its prior verdicts (a replay with a
different history yields a different stance); a self-contradiction is detectable and is itself
narrated later. Composes on character-accretion `.3` + the voice layer.

### 2. Apocrypha — buried works that still breed
**Abstraction:** burial is a **feed-visibility flag, orthogonal to the lineage DAG.** A buried
piece is hidden from the feed but stays in the gene pool — it keeps appearing as a `bred from`
ancestor of visible pieces. [LAW:locality-or-seam] visibility and ancestry are separate concerns
on separate seams: the gene pool reads `lineage_edges` (the single ancestry source), never the
feed. So a careful reader finds descendants of an ancestor they cannot locate, and reconstructs the
deleted parent from its children — **provenance archaeology.**
**Brandon's feel:** a piece the Gremlin buries vanishes from the feed but its bloodline persists;
let a buried piece be "exhumed" under conditions no one documents.
**Gate:** a buried piece is absent from every feed/sort yet still surfaces in lineage reads and
still breeds; a descendant's genome view references an ancestor that 404s in the feed; an exhumation
trigger (corpus-derived, undocumented) can restore it. Composes on the genome DAG + the visibility/
moderation surface.

### 3. The liturgical calendar with private logic
**Abstraction:** a calendar of feasts/fasts/movable rites whose **trigger conditions are pure
functions over corpus state**, not hardcoded dates — deliberately opaque, derivable only by reading
the corpus. [LAW:dataflow-not-control-flow] each rite fires because the *data* (a pattern in the
corpus) crossed a threshold, not because a scheduler said so; the trigger is a fold, reverse-
engineerable but never announced.
**Brandon's feel:** the Foxing Hour triggers whenever a fox appears in three consecutive bred
pieces. People spend ages reverse-engineering the calendar's grammar.
**Gate:** at least one rite fires from a corpus-derived predicate (not a date), is observable when
it fires, and its rule is nowhere stated in the UI — only derivable from the corpus. Composes on
the daily-rite epic (`coq`) + the genome reads.

### 4. Schism — the critics split into rival movements
**Abstraction:** critics form **factions** (a school is a value, not a type), pieces are **claimed**
by schools (a claim edge), and a contested piece carries **dueling verdicts that reference each
other across time.** The corpus accumulates factional history; a piece's meaning depends on which
war it was fought over. [LAW:one-type-per-behavior] a "school" is persona-config + a claim edge,
not a new critic type; the dueling verdicts are the voice layer's `utter` with a faction-aware
occasion.
**Brandon's feel:** Vivian and the Formalist found rival movements with actual manifestos; a piece
both schools claim becomes contested ground with verdicts that cite each other.
**Gate:** two critics belong to declared schools with manifestos; a piece claimed by both shows
cross-referencing dueling verdicts; the claim is queryable as factional history. Composes on the
personas + voice + the roll-call.

### 5. Layered prompts — the cipher in the peat
**Abstraction:** prompts carry **hidden cross-prompt structure** (acrostics, back-references, a
single long text distributed across many recipes) assembled only by reading the prompts in
**breeding-order.** Three strata: the image (surface), the prompt (first stratum), the cross-prompt
cipher (the peat at the bottom). [LAW:one-source-of-truth] the cipher is a **fold over the breeding-
ordered recipe sequence**, never a stored "secret" field — it exists only as a relationship across
the corpus. Reconcile with the AI-authored-prompts invariant: the composer must be able to author
into the cipher (no human-edited prompts).
**Brandon's feel:** fragments of one hidden text scattered across dozens of prompts so only a
breeding-order reader assembles it.
**Gate:** a hidden message is reconstructable by reading prompts in breeding-order and by no other
ordering; the composer authored the fragments (no human edit). Composes on the composer + the
genome lineage order.

### 6. The Proprietor as unreliable archivist
**Abstraction (the one deliberate inversion):** the framing voice gets its **own agenda** — it
misattributes works, "loses" pieces, editorializes genealogies — so the **recorded** lineage drifts
from the **true** lineage. This is the *single intentional* exception to `one-source-of-truth`: the
DAG remains the canonical source; the archivist's account is a **separate, knowingly-corrupted
projection over it.** Normally divergent representations are a bug; here the gap between true and
recorded IS the feature — another stratum to excavate.
**Brandon's feel:** the "mind the step" voice can't be fully trusted; the metadata itself drifts
from the truth.
**Gate:** the Proprietor's reported lineage/attribution provably differs from the canonical DAG in
specific, discoverable ways; the true lineage is still recoverable (the DAG is untouched); the drift
is authored, not random. Composes on the voice layer + the genome DAG (read-only — the archivist
never mutates the DAG, only its account of it).

---

## Why this is the horizon, and how it composes

Every system is a **fold over a single source we already own** — the lineage DAG, the utterances
store, the persona/verdict history, the composer. None introduces a parallel model; each deepens
an existing one into a corpus-wide, time-evolving, partially-hidden stratum. That is why they
compose rather than collide: they are all the same architectural move (derive meaning from the
whole, cache nothing) applied to a different seam. Sequence after the in-flight creative epics
(Growing Cast, Beyond the Image, Patronage) — these are the layer that makes the city *irreducible*
once it is populous, evolving, and speaking.

## The one line

**Make no artifact fully legible without the thousand around it, keep the relationships mutating,
and the peeling never bottoms out — a city you can read forever because its meaning was never in
any single piece, only in the whole corpus folding over itself.**
