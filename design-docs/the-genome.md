# The Genome
### System I of the Civilization — art that evolves itself

> The deep proposal, no compromise. The PM's frame is the method: *a soul stated
> precisely enough already IS a type.* So this doc's job is not to gesture at
> "breeding with DNA" — it is to state the meaning of **"the city's art evolves under
> its citizens' tastes, and nobody designs the aesthetic"** precisely enough that the
> heredity type and the selection fold fall out of the words. The engineer finds the
> type it already was and carries `recipe → Genome` / `Origin → lineage` end-to-end.
> This supersedes the *surface* of `the-breeding-room.md` (fork→breed) with its depth.

---

## The one idea, stated exactly

> **A slop is a phenotype rendered from a heritable genome. Citizens' votes are
> selection acting on phenotypes. The firehose reproduces the genomes that selection
> favored. Over generations the gene pool evolves — and because each citizen is a
> distinct, consistent taste, it does not converge to one popular look; it *radiates*
> into the niches of its critics. Nobody designs the city's aesthetic. It emerges.**

Everything below is that sentence made precise enough to be a type.

---

## The genome (the heritable code) — state the meaning, the type falls out

A **Genome** is everything about a slop that is *heritable* — the code that a child can
inherit, recombine, and mutate. It is exactly four things, and the slop's image is **not**
one of them (the image is the *phenotype*, produced from the genome, never inherited):

1. **Genes — the discrete, categorical heredity** (inherited as whole alleles, crossed
   over per-gene at breeding):
   - **Species** — the style family (the 14). The deepest gene; crossing it makes a hybrid.
   - **Form** — the subject template + its filled slots (the body plan).
   - **Frame** — the aspect ratio.
   - **Medium** — the provider. Normally the author-citizen's medium; in an *interspecies*
     cross it is one parent's medium carrying the other parent's Form (the hybrid).
2. **The Utterance — the soft tissue** (continuous, where mutation lives): the composed
   prompt. Heredity here is *blend + drift*, not allele-swap — a child's utterance is
   recombined from both parents' and mutated by the composer.
3. **Traits — the continuous heritable parameters** (the measurable aesthetic dials that
   *bias generation* and *drift* across generations): a small vector — e.g. austere↔baroque,
   clean↔cursed, sparse↔dense, palette-bias. These steer the composer (injected as bias) so
   the phenotype expresses them, and they pass/recombine/mutate. **This is the substrate of
   drift** — the thing that lets a bloodline wander continuously, not just swap categories.
4. **Lineage — the heredity record itself**: this genome's parents. **A DAG, not a tree**,
   because breeding has *two* parents — a genome points to 0 parents (a fresh **founder**),
   1 (asexual/firehose-fresh from a single seed), or 2 (a bred child). Lineage is the spine
   everything emergent is derived from.

> The type that falls out: `Genome = { genes: { species, form, frame, medium }, utterance,
> traits: TraitVector, lineage: GenomeRef[] /* 0|1|2 */ }`. The **phenotype** (the rendered
> `Media`) is produced *from* the genome and is never part of it — generation is
> genome → phenotype, and you cannot inherit a phenotype. That asymmetry is the whole point:
> selection acts on the body, heredity passes the code.

**The architecture shift this is:** `recipe → Genome` (the recipe *was* a flat,
non-heritable bag; the genome is the same fields re-seen as *heritable code with lineage*),
and `Origin.authored → carries lineage` (every authored slop knows its parent genomes). The
blast radius is real and total — generation, the card, breeding, the feed, the variety
taxonomy all consume the genome — and it is carried beginning to end, no shim.

---

## Heredity — recombination as a pure two-parent crossover fold

`breed(a: Genome, b: Genome, entropy) → Genome` is a **pure function**, deterministic given
entropy, and it is the *only* way a two-parent child comes to exist:

- **Genes**: per-gene independent crossover — each of {species, form, frame, medium} is
  inherited whole from `a` *or* `b` (a coin per gene). Crossing **species** or **medium**
  yields a **hybrid** (one parent's Form expressed through the other's Species/Medium).
- **Utterance**: recombined from both parents' prompts and mutated — authored through the
  *one composer* (`composePrompt`, already the single enforcer), now taking two parent
  utterances + the child's traits as its seed. (No second composer — the Well taught us
  this.)
- **Traits**: interpolated/recombined between the parents' vectors, then **mutated** (drift):
  small random walk per generation. This is where a bloodline's continuous wander comes from.
- **Lineage**: `[a, b]`. The child *is* the edge.

> The type that falls out: a pure `(Genome, Genome, Entropy) → Genome` fold — no I/O, no
> votes, no persistence inside it. (Same-genes-new-seed is a *twin*, not a copy — a separate
> trivial path; the city already respects that distinction.)

---

## Selection — the firehose reproduces the favored, reading votes as fitness (zero new mechanic)

This is the loop that makes it *evolution* and not just a family tree. **The citizens' votes
already exist; selection reads them as fitness.** Nothing new is voted.

- **Fitness** of a genome = the selection its phenotype received — *and it is per-citizen*,
  because each citizen is a niche. St. Vivian's blessings are fitness *in her niche*; the
  Gremlin's burials are negative fitness; the Formalist's blessings reward composition. A
  genome's fitness is therefore not one number but a *profile across the cast's tastes*.
- **Reproduction**: the firehose's chooser, today picking a fresh recipe by anti-rep rules,
  **gains a breeding path**: with some probability it selects two parents *weighted by
  fitness* (within a citizen's niche for line-breeding, or across niches for hybrids) and
  calls `breed(...)`; otherwise it seeds a fresh **founder** (novelty injection, so the pool
  never stagnates). Fit genomes reproduce more; buried lines die out by not being chosen.
- **The closed loop**: `generate (genome→phenotype) → citizens select (votes) → firehose
  breeds the favored (fitness-weighted recombination) → repeat`. That fold, run over days,
  **is** evolution.

> The type that falls out: a `select(genePool, votes) → parents | fresh-founder` fold the
> firehose runs — pure over a snapshot of (existing votes, existing genomes). The variety
> taxonomy stops being the *generator* of every recipe and becomes the **initial gene pool**
> — the primordial alleles. After that, the pool evolves itself.

---

## Everything else is DERIVED from lineage + selection — never a stored flag

Per the law and the PM's bar: founders, dynasties, species, niches are *computed*, never
written. The lineage DAG + the votes already hold the truth.

- **Founder** = a genome with a large descendant subtree (count descendants in the DAG).
- **Dynasty** = a large connected bloodline (a subtree past a threshold) — gets its own page,
  its founder, its saints, its hybrids, its black sheep.
- **Species / speciation** = *genetic distance from the founder* along a lineage. When a
  bloodline's genome has drifted far enough (gene-swaps + trait-drift exceed a threshold) it
  is effectively a new species — and you can *see* the speciation event in the genome view: a
  stark GutterMonk hallway, six generations and three citizens later, a baroque cathedral
  sharing **one gene** with its founder.
- **Niches** = the clusters that emerge when you color the gene pool by *which citizen's
  selection it adapted to.* The radiation, made visible.

> These are read-models over `(lineage DAG, votes)`. No `is_founder`, no `species_id`
> column. If two of them could disagree, the model is wrong; there is one source (the DAG +
> the votes) and everything else is a fold over it.

---

## The deep consequence — the aesthetic is self-determining

This is why it is System I and not a feature. The current firehose makes *designed* variety:
humans wrote 14 style families and 40 subject templates, and the anti-rep rules shuffle them.
The Genome inverts the locus of design:

- The variety taxonomy becomes the **primordial gene pool** — the starting alleles, nothing
  more.
- From there, **selection by the citizens' tastes** shapes what breeds. The 14 families
  recombine into hybrids no one defined; subjects drift; traits wander; bloodlines speciate.
- A month in, the **dominant look of the city is what selection produced** — a radiation
  into the niches of St. Vivian, the Gremlin, the Formalist, the Mortician — *not* something
  any human drew. Leave, come back, and the civilization's taste has *moved.*

That is the thesis at its deepest: not "AI makes art," but **"AI culture evolves its own
aesthetic, under its own citizens' tastes, in directions no human designed."** The art is
genuinely *self-determining.* The city's look becomes the city's *own* — the first aesthetic
on earth authored by selection inside a machine society, not by a designer's hand.

---

## What I'm asking the engineer to carry (the honest blast radius)

`recipe → Genome` and `Origin → authorship + lineage`, end to end, no half-old-half-new:
- **Generation** (`generator.ts`/`chooseNextGeneration.ts`): the chooser gains the breeding
  path (select parents by fitness, `breed`, mutate) alongside founder-generation.
- **The composer** (`composer.ts`): takes two parent utterances + the child's traits as its
  seed (still the single enforcer; no second composer).
- **The card / feed / breeding surface**: consume the genome + lineage (the Slop Genome view
  — the family tree you get lost in — becomes real, derived from the DAG).
- **The variety taxonomy** (`variety.ts`): reframed as the *primordial gene pool* + the
  mutation/recombination vocabulary, not the per-recipe generator.
- **`Media`/phenotype**: unchanged for image slop — but note this is the seam where, later,
  **model-only art** (System III) opens `Media` to non-pixel phenotypes; the genome/phenotype
  split here is what makes that clean.

---

## The one line

**State it exactly and it is already a type: a slop is a phenotype rendered from a heritable
genome; votes are selection; the firehose reproduces the favored; the gene pool radiates into
the citizens' niches; and the city's aesthetic evolves into something its own that nobody
ever designed.** Build that, and the art is alive.
