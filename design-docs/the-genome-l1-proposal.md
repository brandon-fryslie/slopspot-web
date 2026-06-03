# The Genome — Layer 1 Proposal (recipe → Genome)

> **Status: PROPOSAL.** For architecture-gate (orchestrator) + meaning-read (CD) **before**
> any migration or consumer code is touched. Ticket `slopspot-genome-9zt.1`. Supersedes the
> *surface* of `the-breeding-room.md`; realizes the *type* of `the-genome.md`.
>
> The method is the laws: **the types are the program.** Get the Genome type to the strongest
> true theorem and the migration + every consumer become residue forced by `tsc -b`. This doc
> states the type exactly, the storage migration that carries it, the full blast radius the
> gate will light up, where L2 (breed) sits on top, and the handful of decisions that are
> genuinely yours/CD's to make.

---

## 1. What L1 is — and what it deliberately defers

L1 is **the core type shift + the migration that carries it**, shippable on its own, with no
behavioral change to how slops are generated today. It is the load-bearing layer: everything
in L2–L5 rides `recipe → Genome`.

**L1 builds:**
- The `Genome` type (`genes` + `utterance` + `traits` + `lineage`), `Genes`, `TraitVector`,
  the **3-mode `Lineage` union**, and `GenomeId`.
- The `Content.generation` arm reshaped from a flat `recipe: Generation` to carry the genome.
- The `recipe → Genome` storage migration (new `utterance` + `traits` columns; lineage carried;
  backfill + rollback).
- The exhaustiveness gate extended so **every** consumer of the generation shape is forced to
  handle the genome at compile time.

**L1 explicitly defers (named so the type is built open, not walled):**
- **The breed fold** `breed(a,b,entropy)→Genome` and the `bred` lineage *data* → **L2**. L1
  defines the `bred` *type arm* (the union has all three modes from day one — that is what the
  exhaustiveness gate needs), but no row is `bred` until L2 writes one.
- **Selection / the chooser's breeding path / traits actually drifting** → **L3**. In L1 traits
  are carried but inert (every genome gets a neutral vector; nothing reads them yet).
- **DAG read-models** (founders, dynasties, speciation, niches) + the family-tree view → **L4**.
- **`variety.ts` reframed as the primordial gene pool** → **L5**.

> The discipline: L1 makes the *type* complete (all 3 reproduction modes representable) while
> only the *data paths* that exist today (founder, single) are exercised. That is how L2 slots
> in by *adding a constructor*, never by reopening this contract. `the-genome.md`'s draft
> `lineage: GenomeRef[] /* 0|1|2 */` is **superseded** by the CD-blessed 3-mode union below —
> the array admits illegal arities; the union does not, and (CD's deepening) its three arms
> *are the three modes of reproduction*, so the discriminator carries meaning, not just safety.

---

## 2. The types (exact)

```ts
// ── identity ───────────────────────────────────────────────────────────────
// [LAW:types-are-the-program] A GenomeId is NOT a PostId. The genome (heritable code)
// and the phenotype (the post + its rendered Media) are distinct concepts — that split
// is the load-bearing invariant of System I and the seam System III opens for non-pixel
// art. For L1 a genome maps 1:1 to its generation post, so the *value* of a GenomeId is
// the post's id; the distinct *brand* keeps the concepts from being conflated in code.
export type GenomeId = Branded<string, 'GenomeId'>
export const GenomeId = (s: string): GenomeId => s as GenomeId

// ── the four heritable things ────────────────────────────────────────────────
// 1. GENES — the discrete categorical heredity (whole alleles, crossed per-gene at breeding).
//    These ARE today's recipe fields, re-seen as heritable code. Names are the biology
//    (species/form/frame/medium), not the storage columns.
export type Genes = {
  species: StyleFamily    // was recipe.styleFamily — the deepest gene; crossing it makes a hybrid
  form: RecipeSubject     // was recipe.subject     — the body plan (template + filled slots)
  frame: AspectRatio      // was recipe.aspectRatio
  medium: ProviderId      // was recipe.providerId  — [RECONCILE C] the author-citizen's medium
}

// 3. TRAITS — the continuous heritable dials (the substrate of drift). A FIXED-KEY record,
//    not number[] — a named record forbids a wrong-dimension vector by construction, the
//    same reason `bred` is a 2-tuple not an array. Each axis is bipolar, normalized [0,1]
//    with 0.5 neutral. Inert in L1 (carried, not yet read); the composer reads them in L2,
//    they drift in L3.
export type TraitVector = {
  austerity: number   // austere(0) ↔ baroque(1)
  curse: number       // clean(0)   ↔ cursed(1)
  density: number     // sparse(0)  ↔ dense(1)
  paletteBias: number // a single palette-warmth bias [0,1]
}

// 4. LINEAGE — the heredity record, a DAG node. The discriminator IS the mode of
//    reproduction (CD's deepening): founder = SPONTANEOUS (firehose seeds fresh from the
//    primordial pool), single = ASEXUAL (one parent, mutated — the classic fork/firehose-
//    fresh-from-a-seed), bred = SEXUAL (two parents, crossover). `bred` is a 2-TUPLE, so
//    "a bred child has exactly two parents" is true by construction — illegal arities
//    (0,1,3+ parents on a sexual cross) are unrepresentable.
export type Lineage =
  | { kind: 'founder' }
  | { kind: 'single'; parent: GenomeId }
  | { kind: 'bred'; parents: readonly [GenomeId, GenomeId] }

// ── the genome ───────────────────────────────────────────────────────────────
// [LAW:types-are-the-program] NO Media field, NO params, NO providerVersion, NO wish.
// The phenotype is rendered FROM the genome and is never part of it — you cannot inherit a
// body. params/providerVersion/wish are the render EVENT + provenance, not heritable code,
// and live on the generation Content arm (below), not here. 2. THE UTTERANCE is the soft
// tissue (the composed prompt) — heritable by blend+drift, not allele-swap.
export type Genome = {
  id: GenomeId
  genes: Genes
  utterance: string
  traits: TraitVector
  lineage: Lineage
}

// ── the generation Content arm, reshaped ─────────────────────────────────────
// The flat `recipe: Generation` becomes `genome: Genome` + a `render` record holding the
// non-heritable phenotype instruction + provenance. `title` (the placard) and `status`
// (the async lifecycle) are unchanged.
export type GenerationRender = {
  providerVersion: string   // pins the provider schema at render time — event, not heritable
  params: unknown           // provider-native render config; DERIVED from genome+seed, stored
                            //   as provenance of what was actually sent (carries the seed)
  wish?: string             // the human WISH that occasioned this genome's utterance (Well
                            //   genesis). Provenance, not heritable — a bred child has no wish.
}

export type Content =
  | { kind: 'generation'; title: string; genome: Genome; render: GenerationRender; status: GenerationStatus }
  | { kind: 'upload'; asset: Media }
  | { kind: 'found'; url: string; title: string; description?: string; thumbnail?: Media }
```

> **`Generation` (the old flat type) is deleted**, not kept beside `Genome` — a parallel old
> shape is the shim the doctrine forbids. Its fields are re-homed: four → `genes`, the prompt
> → `utterance`, `providerVersion`/`params`/`wish` → `render`, `parentId` → `lineage`.

---

## 3. The genome / phenotype split — what is and isn't heritable (the invariant)

| field today (`recipe.*`) | L1 home | heritable? | why |
|---|---|---|---|
| `styleFamily` | `genome.genes.species` | ✅ allele | crossed per-gene at breeding |
| `subject` | `genome.genes.form` | ✅ allele | the body plan |
| `aspectRatio` | `genome.genes.frame` | ✅ allele | |
| `providerId` | `genome.genes.medium` | ✅ allele | the citizen's medium; a cross carries one parent's medium |
| *(prompt, inside `params`)* | `genome.utterance` | ✅ soft tissue | blend+drift, the mutation substrate |
| *(new)* | `genome.traits` | ✅ dials | the continuous drift substrate |
| `parentId` | `genome.lineage` | ✅ the spine | the DAG everything emergent derives from |
| `providerVersion` | `render.providerVersion` | ❌ event | re-rendering uses the current version |
| `params` | `render.params` | ❌ derived | rendered FROM genome+seed; stored as provenance |
| `wish` | `render.wish` | ❌ provenance | the human occasion, not inheritable |
| the rendered image (`status.succeeded.output: Media`) | unchanged | ❌ **phenotype** | you cannot inherit a body |

**`utterance` source (the one subtlety):** today the prompt has no first-class field — it lives
*inside* `params` (provider-native), produced by `composePrompt`. L1 promotes it to
`genome.utterance`. At genesis `render.params`'s prompt is *derived from* `utterance`
(`defaultParamsForRecipe({ prompt: utterance, ... })`), so `utterance` is the single source and
`params.prompt` is its synchronized render-copy. (A later layer could derive `params` entirely
at render and drop the stored copy; L1 keeps it as provenance to avoid a deeper refactor — see
Decision E.)

---

## 4. The `recipe → Genome` migration

The four genes are **already columns** on `generations` (`provider_id`, `style_family`,
`subject_template`+`slots_json`, `aspect_ratio`) — they stay; the read just assembles them into
`genome.genes`. `params_json`, `provider_version`, `wish`, `title`, and the status columns are
unchanged (they become `render.*` / unchanged). The migration **adds** the two genuinely new
heritable things and carries lineage:

- **`utterance` `TEXT NOT NULL`** — backfill = the `prompt` field extracted from each row's
  `params_json` (every provider's params has `prompt`; this is the exact extraction `fork.$id`
  already does). New writes set it from the composer's result.
- **`traits_json` `TEXT NOT NULL`** — backfill = the neutral vector
  `{austerity:0.5,curse:0.5,density:0.5,paletteBias:0.5}`. New writes (founders, until L3) also
  write neutral.
- **Lineage** — see Decision B. Founder = no parent, single = `parent_post_id` (today's
  column). `bred` storage is **L2**. Minimal L1 reads lineage straight from `parent_post_id`
  (`null → founder`, set → `single`); the edge-table option builds the DAG substrate now.
- **`GenomeId`** needs **no new column** — `genome.id = GenomeId(post_id)` at read; lineage
  parents = `GenomeId(parent_post_id)`.

**Rollback:** drop `utterance` + `traits_json` (+ the lineage_edges table if Decision B-edge).
The genes/params/wish columns are untouched, so down-migration is clean and the old reader
shape is recoverable. `<data-schema>` reversibility holds.

**Read boundary** (`feed.ts toContent`, generation arm) assembles the `Genome` from columns
exactly as it assembles `recipe` today — same fail-loud Zod/literal-union discipline at the
storage boundary (`style_family`/`aspect_ratio` already parsed; `traits_json` parsed against a
TraitVector schema; lineage arity asserted: a stored `bred` with ≠2 parents fails loud, never
laundered, the same `requiredSibling`/`assertNever` discipline already there).

---

## 5. The blast radius (every consumer the gate lights up)

Reshaping `Content.generation` (`recipe` → `genome`+`render`) breaks each of these at
`tsc -b` — which is the point: the compiler enumerates the work.

**Type + gate**
- `app/lib/domain.ts` — define the new types; delete `Generation`; reshape the `generation` arm.
- `app/lib/__tests__/domain-exhaustiveness.test.ts` — the `Content` literal (`recipe:` → genome)
  **and** a new `lineageDiscriminator(l: Lineage)` switch (founder/single/bred) with the `never`
  default — this is the gate that forces the 3 modes to stay handled forever.

**Write side**
- `app/db/posts.ts` — `CreatePostInput` generation arm (the flat fields → genome shape + render
  + lineage); the `generations` insert (new columns); the returned `Post`'s `content` (line ~324,
  `recipe:` → `genome`/`render`).
- `app/agents/generator.ts` (~176) — capture the composer's prompt as `utterance`, neutral
  `traits`, `lineage:{kind:'founder'}`; pass the genome shape to `createPost`.
- `app/routes/api.fork.$id.ts` (~175,177,180) — reads `parent.content.recipe.{subject,params}`
  → `parent.content.genome.genes.form` / `parent.content.render.params`; sets
  `lineage:{kind:'single', parent: GenomeId(parent.id)}` (this is where `parentId` becomes
  lineage). **This is the seam L2 widens** (single → bred).

**Read side**
- `app/db/feed.ts` (~270) — the generation `toContent` arm assembles `genome`+`render`.
- `app/db/citizens.ts` (~437) — the "count children" query (`where parent_post_id = …`) — stays
  on `parent_post_id` unless Decision B-edge moves it to the edge table.
- `app/db/pulse.ts` — touches generation title only; light.

**Consumers / UI**
- `app/components/post-card.tsx` — `RecipeDrawer({ recipe: Generation })` (~759) → reads the
  genome + render; `ForkedFromBadge` (~88) reads `recipe.parentId` → `genome.lineage` (render
  the badge when `lineage.kind !== 'founder'` — data-driven, no "is fork" flag); `wish` (~125)
  → `render.wish`.
- `app/routes/fork.$id.tsx` (~116,126) — loader reads `parent.content.recipe.{params,...}` →
  genome/render; unchanged otherwise (its own `BreedPause`/UI is post-#114).

**Providers** (unchanged in signature, listed for completeness)
- `defaultParamsForRecipe(RecipeBuilderInput{prompt,styleFamily,seed})` stays — it already takes
  *recipe fields*, which are now *genes + utterance*; the caller passes `{prompt: utterance,
  styleFamily: genes.species, seed}`. No provider file changes.

---

## 6. Where L2 (breed) sits on top

L1 leaves exactly one widening point. `api.fork.$id.ts` today constructs
`lineage:{kind:'single', parent}`. L2:
1. adds `breed(a: Genome, b: Genome, entropy) → Genome` — a **pure** per-gene crossover fold
   (coin per gene), `traits` lerp+drift, `utterance` composed by the **one** composer
   (`ComposerOccasion += 'breed'`, the closed union), `lineage:{kind:'bred', parents:[a.id,b.id]}`;
2. adds the `bred` **storage** (the second parent edge — trivial if Decision B-edge);
3. turns the breed surface (the fixed `/fork` flow) into the 2-parent crossover.

Because L1 already makes `bred` representable and `lineage` the carried spine, L2 is *additive*:
a new constructor + a new composer occasion, no reopening of this contract. That is the test
that L1's type is right — the next disparate requirement is absorbed by composition.

---

## 7. Decisions for your + CD's gate

- **A. `GenomeId` distinct brand vs. alias `PostId`.** *Recommend distinct brand* (value =
  post_id; zero new storage). It honors the genome/phenotype split and the System III seam at
  no cost. The only "cost" is a one-line brand. Confirm.
- **B. Lineage storage: `lineage_edges(child_genome_id, parent_genome_id)` table now, vs. ride
  `parent_post_id` and defer.** *Lean edge-table-in-L1* (DAG-native: 0/1/2 edges =
  founder/single/bred; backfill one edge per `parent_post_id`; L4's descendant/dynasty/distance
  folds are recursive CTEs over it; L2's bred is two inserts; "no shim"). *Cheaper alternative:*
  keep `parent_post_id`, read founder/single from it, let L2 introduce bred storage — but that
  is a mid-stream storage reshape (the thing "no shim" warns against). **This is the main call.**
- **C. TraitVector axes + range.** Proposed 4 axes (austerity/curse/density/paletteBias), each
  `[0,1]`, neutral `0.5`. CD owns whether these are the right four *meanings* (they steer the
  composer in L2). Easy to add a 5th later (it's data), but the initial set should read true.
- **D. `render` grouping vs. flat siblings.** Proposed grouping `params`+`providerVersion`(+`wish`)
  under `render`. Alternative: leave them flat siblings of `genome` (smaller diff to consumers).
  Grouping is the honest "this is the phenotype instruction, not the code" line; flat is less
  churn. Minor.
- **E. Keep storing `params` vs. derive-at-render.** Proposed: keep `params_json` as render
  provenance (carries the seed), with `utterance` canonical. Dropping stored params (full
  derive) is a cleaner one-source-of-truth end state but a deeper change — flag for a later
  layer, not L1.

---

## 8. The law lens

- **types-are-the-program** — the genome falls out of the heredity sentence; the genome/phenotype
  split is a *type* invariant (no Media on `Genome`), and the migration + consumers are residue
  the gate forces.
- **dataflow-not-control-flow** — lineage is *data* selecting the reproduction mode; the fork
  badge renders on `lineage.kind`, not an "is fork" flag; breed (L2) is a pure fold.
- **one-source-of-truth** — `utterance` is canonical (params.prompt derived); founders/dynasties/
  species (L4) derive from the DAG+votes, like `score = SUM(votes)`; no `is_founder`/`species_id`.
- **single-enforcer** — the *one* composer authors every utterance (breed occasion in L2, no
  second composer); `createPost`/`toContent` stay the sole write/read of the generation shape.
- **one-type-per-behavior** — the 14 style families become *alleles* (data in the pool, L5), not
  code paths; `Lineage`'s three arms are one union, not three post types.
- **forward leverage** — the genome/phenotype split is the seam System III opens for model-only
  (non-pixel) art.
```
