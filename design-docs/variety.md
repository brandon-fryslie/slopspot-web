# Variety Taxonomy

**Status:** Approved design, ready to implement
**Implementation epic:** `slopspot-variety-pl6`
**This doc is the canonical spec for:** `slopspot-variety-pl6.2` (style metadata on `Generation`) and `slopspot-variety-pl6.5` (variety-aware chooser). Once those tickets implement the enums and rules below, this doc becomes lookup, not policy.

---

## Why this exists

Variety is the whole product-quality signal. A samey feed kills SlopSpot
regardless of how clean the architecture is. The epic body already names the
five dimensions — model, style, subject, aspect, format — but "be varied" is
not a thing the firehose chooser can act on. It needs *concrete*
enumerations, weights, and anti-repetition rules. This doc is the conversion
of the abstract dimensions into the concrete tables.

The downstream tickets should be **mechanical** after this lands:

- `pl6.2` extends the `Generation` type with `styleFamily: StyleFamily`,
  `aspectRatio: AspectRatio`, and `subject: RecipeSubject` (a
  template-discriminated union where each variant carries exactly the slots
  its phrase references — see "Implementation seams" for the shape). All
  names and values come from this doc.
- `pl6.5` is a chooser that, given the last N persisted posts, selects
  `(styleFamily, RecipeSubject, providerId, aspectRatio)` according to the
  weights and anti-repetition rules below. The chooser's output type
  excludes the legacy template (`T00`) by construction. No new policy
  decisions; every check is already named here.

[LAW:types-are-the-program] — the point of this doc is to make the
constraints concrete enough that the *type* of a `Generation` recipe is
exactly the shape of legal variability. Once the enums and discriminated
union exist, a malformed recipe (style family that doesn't exist, slots
that don't match the chosen template, chooser producing a backfill-only
template) is unrepresentable.

---

## Style families

Fourteen named aesthetic territories. Each is **distinctive** (no two should
produce overlapping outputs from the same provider) and **prompt-able**
(can be reliably steered with a short prompt fragment, no model-specific
prompt engineering required).

Identifiers are the lowercase-hyphenated tokens used by code. The one-line
"prompt seed" is what gets concatenated with the subject phrase to form the
final prompt.

| id                          | name (display)             | prompt seed                                                                                |
|-----------------------------|----------------------------|--------------------------------------------------------------------------------------------|
| `oil-painting`              | Oil painting               | `oil painting on canvas, visible brushwork, classical composition, museum-piece lighting`  |
| `photoreal`                 | Photoreal                  | `photograph, 35mm lens, natural light, shallow depth of field, color-graded like Kodak Portra` |
| `cyberpunk-neon`            | Cyberpunk neon             | `cyberpunk city at night, neon signage in mixed languages, wet asphalt reflections, dense wiring` |
| `liminal`                   | Liminal space              | `empty interior at off-hours, fluorescent overhead lighting, no people, slight wide-angle distortion` |
| `low-poly`                  | Low-poly (PS1-era)         | `low-polygon 3D render, untextured or single-texture surfaces, PS1/N64-era, hard vertex shading` |
| `vaporwave`                 | Vaporwave                  | `pink-and-teal palette, marble bust, palm fronds, late-90s computing artifacts, dreamy grid` |
| `watercolor`                | Watercolor                 | `watercolor on cold-press paper, soft edge bleeding, washy pigments, paper grain visible` |
| `anime`                     | Anime                      | `anime cel-shading, expressive line work, manga-style composition, flat color fills with one rim light` |
| `cottagecore`               | Cottagecore                | `rural pastoral, hand-knit textures, dappled afternoon sun, embroidery and wildflowers, soft-focus` |
| `haunted-mundane`           | Haunted mundane            | `everyday scene with one wrong thing, suburban setting, uncanny stillness, eye-level photograph` |
| `1990s-cgi`                 | 1990s CGI                  | `early Pixar / Reboot-era 3D render, plastic shaders, hard rim light, primary-color materials` |
| `botanical-illustration`    | Botanical illustration     | `Victorian field-guide plate, ink line work with watercolor wash, Latin label, plain background` |
| `brutalist-architecture`    | Brutalist architecture     | `monolithic concrete, hard noon light, geometric mass, no people, slightly grainy medium-format` |
| `risograph-print`           | Risograph print            | `risograph print, limited 2–3 color palette (fluoro pink, teal, black), visible registration drift, paper texture` |

These are intentionally **clusters with sharp edges**, not a smooth aesthetic
space. The point is that any two consecutive posts pulled from different
families should *feel* different at a glance. A smooth taxonomy (one
"painterly" axis with twelve points along it) would defeat the purpose:
adjacent points would feel identical and the feed rhythm would collapse.

Adding a family is a doc edit + an enum entry. Removing one is harder
(historical posts may reference it) — prefer to leave-and-deprecate.

---

## Subject templates

Forty active templates plus one legacy-only template (`T00`), each a string
with `{slot}` placeholders. Slots are filled from vocabularies (next
section) at chooser time. The composed phrase is the *subject* — what the
image is "of." The style family's prompt seed is then appended (or
prepended, per provider quirks) to produce the final prompt.

Each template has an `id` (used by the chooser for anti-repetition tracking)
and a `phrase` (the slot string). `T00` is a single-slot escape hatch for
backfilling rows that pre-date this schema; see "Implementation seams" for
when it's populated and the rule that the chooser must never sample it.

```
T00  "{freeText}"                                                          // legacy/backfill only — chooser MUST exclude
T01  "a {animal} working as a {profession}"
T02  "an {animal} performing an act of {emotion}"
T03  "the last {profession} of the {era}, retiring"
T04  "a {manMadeObject} from the {era}, abandoned in a {setting}"
T05  "{setting} at {timeOfDay}"
T06  "a {naturalObject}, photographed as if it were a {manMadeObject}"
T07  "a {manMadeObject}, photographed as if it were a {naturalObject}"
T08  "a {animal} thinking about {abstractConcept}"
T09  "a vending machine that dispenses {abstractConcept}"
T10  "diagram of how a {manMadeObject} actually works (charmingly wrong)"
T11  "instructions for using a {manMadeObject} you have never seen"
T12  "a {profession} on their first day, posing for a portrait"
T13  "the {era} version of a {manMadeObject} that does not yet exist"
T14  "a {animal} accepting a small award for {abstractConcept}"
T15  "{setting}, but it is the {era}"
T16  "a still life of {manMadeObject} and {naturalObject}, arranged like a memory"
T17  "a {animal} reading a {manMadeObject}"
T18  "a {profession} who is secretly a {animal}"
T19  "the {abstractConcept} room of a {setting}"
T20  "a postcard from a {setting} that is not real"
T21  "the saddest {manMadeObject} in the {setting}"
T22  "a {animal} that has just learned about {abstractConcept}"
T23  "an instruction manual page for {abstractConcept}"
T24  "a {naturalObject} that is also a {profession}'s workplace"
T25  "the official {era} portrait of {animal}, oil-finished even when it isn't oil"
T26  "a {manMadeObject} that has been given a small, dignified ceremony"
T27  "a community board flyer for an event called {abstractConcept}"
T28  "{setting}, after closing time, still warm"
T29  "a {animal} captured in the act of forgetting"
T30  "a {profession} whose only client is a {animal}"
T31  "a {manMadeObject} that has outlived its purpose by a wide margin"
T32  "a {naturalObject} explained by a {profession} who does not understand it"
T33  "a {animal} that has been crowned for an obscure achievement"
T34  "a {era} appliance that promises {abstractConcept}"
T35  "a {setting} that you can only reach through a {setting}"
T36  "a study of {naturalObject}, mounted and labeled by a {profession}"
T37  "the {abstractConcept} drawer of a {profession}'s desk"
T38  "a {animal} that has gone into politics"
T39  "a {manMadeObject} found in a {setting} where it does not belong"
T40  "a {profession} caught daydreaming about a {naturalObject}"
```

The templates are intentionally **slightly absurd**. SlopSpot is an aggregator
for AI-generated content and a low-key argument about AI authorship — the
content should have a strong editorial voice, not produce stock photography.
A literal template like "a cat" makes a forgettable image; "a fennec working
as a lighthouse-keeper, captured in the act of forgetting" makes an image
worth scrolling.

### Template rendering (article normalization)

Templates are written with English-readable indefinite articles ("a {animal}",
"an {animal}") because that's how they read in source. The pl6.5 renderer
owns article correctness: whenever an `a` or `an` token appears immediately
before a `{slot}` placeholder, the renderer **replaces it** with the article
that matches the resolved slot value's first character (vowel letter → `an`,
otherwise → `a`). Articles that appear elsewhere in the template (before
literal words like "act", "event", "instruction manual page") are emitted
verbatim.

Heuristic: lowercase the resolved value's first character, then apply the
vowel-letter check. `a`/`e`/`i`/`o`/`u` → `an`, else → `a`. The lowercase
step matters because vocab items include uppercase starts (`ATM`,
`Edwardian`, `Edo-period`) — a literal lowercase-only check would emit
"a ATM" or "a Edwardian appliance". This is a first-character heuristic,
not pronunciation-aware — it gets most cases right but doesn't model
phonemes.

The heuristic covers ≥95% of cases in the current vocabularies. Known
edge cases that the heuristic gets wrong (silent "h" — "honest", numeric
leading — "1970s" pronounced "nineteen") are not currently handled; pl6.5
may add a per-vocab override table if it becomes worth it. Wrong article
in 5% of generations is a smaller harm than coupling vocab items to their
pronunciation today.

The renderer scans every template once for `(a|an) {slot}` occurrences and
rewrites those positions; templates with no matching positions experience
zero rewrites (they pass through verbatim). No per-template special-casing
required — the rule is uniform across the table.

### Slot vocabularies

```
animal
  cat, dog, otter, raven, owl, octopus, fennec, capybara, axolotl, salamander,
  hare, fox, magpie, donkey, badger, peacock, narwhal, pangolin, manatee,
  heron, marmoset

profession
  surgeon, sommelier, librarian, locksmith, falconer, accountant, beekeeper,
  archivist, lighthouse-keeper, mortician, cartographer, lexicographer,
  taxidermist, organist, harbor-pilot, clockmaker, perfumer, cooper,
  bookbinder, glassblower, claims-adjuster

manMadeObject
  pay-phone, ATM, vending-machine, slot-machine, telegraph, dial-phone,
  jukebox, fax-machine, microfilm-reader, dictaphone, overhead-projector,
  cash-register, telex, ham-radio, slide-projector, polaroid-camera,
  filing-cabinet, rotary-rolodex, ticket-punch, parking-meter

naturalObject
  river, mountain, glacier, fjord, marsh, dune, geyser, mangrove, salt-flat,
  caldera, oxbow-lake, sinkhole, terraced-hillside, peat-bog, tide-pool,
  cloud-bank, kelp-forest, granite-outcrop

setting
  motel-corridor, suburban-cul-de-sac, abandoned-mall, hospital-waiting-room,
  gas-station, subway-platform, lobby-of-a-regional-bank,
  reception-of-a-DMV, indoor-pool-after-hours, school-gymnasium-stage,
  parking-garage-stairwell, public-library-mezzanine, conference-hotel-bar,
  airport-chapel, rural-funeral-home, community-center-basement

timeOfDay
  golden-hour, blue-hour, just-after-sunrise, late-afternoon-flat-light,
  noon, deep-night, dawn-with-fog, the-hour-after-it-rains

era
  1970s, 1990s, Edwardian, late-Soviet, post-9/11-Y2K, antebellum,
  Edo-period, interwar, 1980s-mall-era

emotion
  melancholy, tender, anxious, content, awestruck, suspicious, weary,
  reverent, sheepish, embarrassed, delighted-but-trying-not-to-show-it,
  gently-baffled

abstractConcept
  patience, regret, almost-remembrance, the-feeling-of-clean-laundry,
  small-victories, vocational-pride, the-second-half-of-an-anecdote,
  bureaucratic-grace, hospitality, the-passage-of-time, residual-warmth,
  permission, archival-care

freeText  (used only by template T00, see below)
  — opaque string carried as-is; no vocabulary, no enumeration. Populated
  exclusively by the pl6.2 backfill for rows that pre-date the recipe
  schema. The chooser MUST exclude T00 from sampling for new generations.
```

Slot vocabularies live in the same enum file as templates (`pl6.2`). Adding
a vocabulary item is one line.

---

## Model assignment (weighting, not mapping)

Each style family has a **primary provider** (weight 1.0) and zero, one, or
two **secondary providers** (weights 0.5 or 0.3). When the chooser commits
to a style family it then samples a provider from the weighted distribution.
This deliberately *does not* hardcode style → provider; it just biases
toward the model that does that style best given current state of providers.

**Provider ids referenced in this doc:** `fal-flux` matches today's
`app/providers/fal-flux.ts`. `replicate-sdxl` is the **real provider that
`slopspot-variety-pl6.3` introduces** — today the registry only has
`replicate-sdxl-mock`. The weights below reference the future real id
because the spec describes the end state; the mock provider keeps its
own id (`replicate-sdxl-mock`) and is used by tests, never by the chooser
in production. Until pl6.3 lands, the chooser falls back to `fal-flux`
for every style family (the only registered real provider), and the
SDXL-weighted styles still ship but all via fal — accepted as a
suboptimal-during-transition state, not a permanent design.

| style family            | fal-flux | replicate-sdxl | (TBD third) |
|-------------------------|----------|----------------|-------------|
| oil-painting            | 0.3      | **1.0**        | —           |
| photoreal               | **1.0**  | 0.3            | —           |
| cyberpunk-neon          | 0.5      | **1.0**        | —           |
| liminal                 | **1.0**  | 0.3            | —           |
| low-poly                | 0.3      | **1.0**        | —           |
| vaporwave               | 0.5      | **1.0**        | —           |
| watercolor              | 0.3      | **1.0**        | —           |
| anime                   | 0.3      | **1.0**        | —           |
| cottagecore             | 0.5      | **1.0**        | —           |
| haunted-mundane         | **1.0**  | 0.5            | —           |
| 1990s-cgi               | **1.0**  | 0.5            | —           |
| botanical-illustration  | 0.5      | **1.0**        | —           |
| brutalist-architecture  | **1.0**  | 0.3            | —           |
| risograph-print         | 0.3      | **1.0**        | —           |

Reasoning (not policy — just the why behind the numbers):

- FLUX schnell is photorealistic-leaning and clean. It excels at photographic
  styles (photoreal, liminal, haunted-mundane, brutalist) and at the "clean
  plastic" of 1990s-cgi. It's weaker on painterly textures (visible brush,
  watercolor bleed, ink work).
- SDXL is the painterly/illustrative workhorse — oil, watercolor, anime, low-poly,
  cottagecore, botanical-illustration, risograph, vaporwave, cyberpunk-neon
  all play to its strengths.
- The third provider slot is reserved for a tonal outlier (Imagen, Ideogram,
  FLUX pro) — its weights are TBD until pl6.3.1 (real third provider) lands.
  When it does, *some* style families should re-weight to give the third
  provider the lead; the doc gets edited then.

**[LAW:one-source-of-truth]** — these weights are the *single source* for
provider selection. The chooser must not hardcode an alternative mapping.

---

## Aspect ratio policy

Feed rhythm matters because consecutive same-shape thumbnails read as
monotonous regardless of content.

**Distribution (target, sampled per generation):**

| aspect | share |
|--------|-------|
| `1:1`  | 60%   |
| `16:9` | 20%   |
| `9:16` | 15%   |
| `4:3`  | 3%    |
| `3:4`  | 2%    |

**Style-family bias (multipliers on the distribution above, normalized):**

- `brutalist-architecture`, `cyberpunk-neon`, `liminal`: 1.5× on `16:9` and
  `4:3` (these styles benefit from horizontal mass).
- `anime`, `1990s-cgi`, `botanical-illustration`: 1.5× on `9:16` and `3:4`
  (vertical character/figure-focused work).
- All other families: use the base distribution.

**Provider translation** — the chooser commits to an aspect ratio token
(`1:1` | `16:9` | `9:16` | `4:3` | `3:4`). The provider layer translates:

- `fal-flux`: maps to fal's `image_size` enum. The five tokens correspond
  to `square_hd`, `landscape_16_9`, `portrait_16_9`, `landscape_4_3`,
  `portrait_4_3` respectively. **State of the codebase today** (2026-05):
  `app/providers/fal-flux.ts` only declares the first three in its
  `paramsSchema`. pl6.2 widens the schema to all five — fal's
  `image_size` already supports the additional two, the gap is just in
  our enum declaration. Until pl6.2 ships, the chooser MUST NOT pick
  `4:3` or `3:4` for `fal-flux` (the schema would reject). Several
  `4:3`/`3:4`-biased style families are fal-flux-primary
  (`liminal`, `brutalist-architecture`, `cyberpunk-neon`), so the
  bias does *not* on its own avoid the gap — the per-provider
  supported-ratio gate (next bullet) is the single mechanism that
  enforces the constraint.
- `replicate-sdxl`: explicit (w,h) — table:

  | token  | w    | h    |
  |--------|------|------|
  | `1:1`  | 1024 | 1024 |
  | `16:9` | 1344 | 768  |
  | `9:16` | 768  | 1344 |
  | `4:3`  | 1152 | 896  |
  | `3:4`  | 896  | 1152 |

**[LAW:single-enforcer]** — the aspect-ratio enum is the canonical form. Each
provider translates it once, in its own provider file. The chooser must
*never* output (w,h) directly. Per-provider supported ratios live in the
provider file's `paramsSchema` (and the chooser reads `provider.supportedAspectRatios`
to filter the sampling distribution); the canonical `AspectRatio` enum is the
union of all provider-supported ratios, not a per-provider subset.

---

## Anti-repetition rules

Mechanical rules the chooser applies given a sliding window of the most
recent N persisted posts (chronological by `createdAt`). Each rule rejects
candidate `(styleFamily, subjectTemplate, providerId, aspectRatio)` tuples;
the chooser samples-and-rejects until a tuple satisfies all rules.

| id   | window  | rule                                                                                |
|------|---------|-------------------------------------------------------------------------------------|
| R1   | last 1  | `styleFamily` must differ from the most recent post's `styleFamily`.               |
| R2   | last 5  | `subjectTemplate` must not appear in the last 5 posts.                              |
| R3   | last 1  | If ≥2 providers are registered, `providerId` must differ from the most recent post's. |
| R4   | last 2  | If the most recent two posts share the same `aspectRatio`, the candidate must differ from it. (Two-in-a-row is allowed; three-in-a-row is not.) |
| R5   | last 20 | Soft-downweight (×0.3) any `styleFamily` that has appeared ≥3 times in the last 20. |
| R6   | last 20 | Soft-downweight (×0.5) any slot-fill value that has appeared in the last 20 posts (per slot type). |

R1–R4 are **hard rejections**; the chooser must satisfy them. R5–R6 are
**soft re-weights** applied during sampling, not rejections — they shape
the long-run distribution without producing the corner case of "no
candidate tuple survives."

**Bootstrap behavior:** when the persisted feed has <20 posts, anti-rep
rules degrade gracefully — R2 reduces its window to `min(5, feedSize)`, R5
and R6 turn off until 20 posts exist. The bootstrap content load already
provides 20 posts (`slopspot-content-ct9`), so this only matters for fresh
databases.

**Why not LLM-driven anti-repetition?** Because the chooser fires from the
cron and from `POST /api/generate`. It must be deterministic, cheap, and
have no out-of-process dependency. A mechanical sliding window over recent
posts is all of those things.

---

## Format variety (explicit deferral)

Stills only for now. Video and audio land when the budget guard
(`firehose-c37.2`) accommodates them — current fal.ai daily cap is
$5/day with ~$0.003/still, so we can't afford even one ~$0.10 video per
day yet. The `Media` discriminated union already has `video` and `audio`
variants ([LAW:one-source-of-truth] — they're not getting added, they're
already there); when format variety joins the chooser, it picks `mediaKind`
*before* style family and a `style × mediaKind` weighted distribution
takes over from the table above. **Out of scope for this doc.**

---

## Implementation seams

Where downstream tickets land the code that consumes this doc:

- **`pl6.2`** — `app/lib/domain.ts` + providers + D1:
  - `StyleFamily` literal-union type with the 14 ids above. `AspectRatio`
    literal-union over `'1:1' | '16:9' | '9:16' | '4:3' | '3:4'`.
  - **Two `SubjectTemplateId` types**, deliberately split per [LAW:types-are-the-program]
    — the rule "the chooser never produces T00" is enforced by the type, not
    by an assertion:
    ```ts
    type ChooserSubjectTemplateId = 'T01' | 'T02' | /* ... */ | 'T40'  // 40 ids
    type StoredSubjectTemplateId  = 'T00' | ChooserSubjectTemplateId    // 41 ids
    ```
    The chooser's *return type* uses `ChooserSubjectTemplateId`; the recipe
    parser (D1 read path) uses `StoredSubjectTemplateId`. `ChooserSubjectTemplateId`
    assigns to `StoredSubjectTemplateId` for free (structural superset).
    The reverse — the chooser's *input*, which IS the last-N stored recipes
    for anti-rep evaluation — needs explicit narrowing: the chooser reads
    a `StoredSubjectTemplateId[]` slice, then filters out the T00 rows
    (`row.subjectTemplate !== 'T00'`) to produce a `ChooserSubjectTemplateId[]`
    working set for R-rule evaluation. The narrowing is a `.filter()` plus
    a type predicate, not a cast, so the type system rejects any path that
    forgets it. See the pl6.5 seam below for where this lands.
  - **`RecipeSubject` discriminated union**, NOT a bag of optionals. One
    variant per template id; each variant carries exactly the slots its
    phrase references. The type makes `(subjectTemplate: 'T01', slots: {})`
    unrepresentable — the compiler refuses. Shape:
    ```ts
    type RecipeSubject =
      | { subjectTemplate: 'T00'; slots: { freeText: string } }
      | { subjectTemplate: 'T01'; slots: { animal: string; profession: string } }
      | { subjectTemplate: 'T02'; slots: { animal: string; emotion: string } }
      | { subjectTemplate: 'T03'; slots: { profession: string; era: string } }
      | { subjectTemplate: 'T04'; slots: { manMadeObject: string; era: string; setting: string } }
      | { subjectTemplate: 'T05'; slots: { setting: string; timeOfDay: string } }
      // ... one variant per row in the templates table, slots derived
      //     mechanically from the {placeholders} in that template's phrase.
    ```
    The 41 variants are mechanically derivable from the templates table by
    inspecting each phrase's `{placeholders}`. A small codegen helper or
    hand-written list is fine — both produce identical types. Anti-rep R6
    iterates `RecipeSubject['slots']` via a generic helper, not by hardcoding
    slot names; same generic works for every variant.
  - The `Generation` type (the recipe — `Content.kind === 'generation'` carries
    `recipe: Generation`) gains: `styleFamily: StyleFamily`, `aspectRatio:
    AspectRatio`, and `subject: RecipeSubject` (the discriminated union
    above — `subjectTemplate` and `slots` live inside the union, not as
    sibling fields). These join the existing `providerId`,
    `providerVersion`, `params: unknown`, `parentId?`.
  - **Lifting `aspectRatio` is a migration**, not an addition. Today
    `app/providers/fal-flux.ts`'s `paramsSchema` carries `aspectRatio`
    inside `params` AND only declares 3 of the 5 canonical values (`1:1`,
    `16:9`, `9:16`). pl6.2 does both: removes `aspectRatio` from
    `paramsSchema` (so it lives on `Generation`) AND widens fal-flux's
    accepted aspect ratios to all 5 (fal's `image_size` already supports
    `landscape_4_3`/`portrait_4_3` — the gap is just in our enum).
    The provider layer becomes a pure translator from canonical
    `AspectRatio` to provider-native `image_size`/`(w,h)`.
    [LAW:one-source-of-truth] — one canonical representation, providers
    translate at their boundary.
  - **`GenerationProvider<P>` interface gains `supportedAspectRatios:
    readonly AspectRatio[]`** so the chooser can filter the sampling
    distribution per-provider without per-provider conditional code. The
    chooser samples `aspectRatio` from the policy distribution intersected
    with the chosen provider's supported set. If `replicate-sdxl` later
    supports a sixth ratio that `fal-flux` doesn't, the chooser adapts by
    reading the metadata, not by branching.
    - Callers updated:
      - `app/db/feed.ts` — the `getFeed` reader returns recipe-extended
        rows; the JSON parse at the read boundary reconstructs
        `RecipeSubject` from the flattened `subject_template`+`slots`
        columns.
      - `app/db/posts.ts` — `createPost` accepts the new fields on its
        input and writes them to D1 in the running→terminal transaction.
      - `app/routes/api.generate.ts` — the external action's
        `bodySchema` accepts `styleFamily`, `subject` (a `RecipeSubject`
        literal), and `aspectRatio` as top-level fields; the provider's
        `params` no longer carries `aspectRatio`.
      - `scripts/bootstrap-seed.ts` — backfill pre-existing rows with
        the T00/photoreal sentinel shape described below, OR regenerate
        the seed under the new schema (pl6.2's call).
      - Stale reference cleanup: `CLAUDE.md` currently describes an
        `app/lib/seed.ts` that does not exist (the actual file is
        `app/db/feed.ts`); pl6.2 should fix that line while it's
        editing the architecture section, or a small followup ticket
        owns just the CLAUDE.md correction.
  - D1 schema: add columns to the `generations` table (`style_family TEXT
    NOT NULL`, `subject_template TEXT NOT NULL`, `slots JSON NOT NULL`,
    `aspect_ratio TEXT NOT NULL`). The two-column representation
    (`subject_template` + `slots`) flattens the `RecipeSubject`
    discriminated union for storage; the parse step at the D1 read boundary
    reconstructs the union (it's the trust boundary, so a Zod schema that
    enforces "slots match what `subjectTemplate` requires" lives there).
    Slot-id casing: the JSON column stores camelCase keys exactly matching
    the TS type's keys ({ "manMadeObject": "ATM" }, { "freeText": "..." }
    — never kebab-case in JSON or TS).
  - **Backfill** for existing rows (the `ct9` bootstrap + any cron output
    produced before pl6.2 ships, ~tens of rows):
    - `style_family`: sentinel `'photoreal'` (the closest match to fal-flux
      default output; this is metadata-only, the image is already produced)
    - `subject_template`: `'T00'` (the legacy escape hatch — only T00
      reads/writes route through `StoredSubjectTemplateId` here; the
      chooser's `ChooserSubjectTemplateId` can never produce it)
    - `slots`: `{ "freeText": "<original prompt verbatim>" }`
    - `aspect_ratio`: read out of the existing `params.aspectRatio`
    Backfilled rows render in the feed but never feed back into chooser
    decisions (because the chooser's type literally cannot produce T00 and
    R-rules operate on the stored type viewed through a filter that drops
    T00 rows). If a future ticket wants to retro-classify the backfilled
    rows into real (`T01`–`T40`) templates by prompt-string matching,
    that's a separate concern — `T00` is the floor, not the ceiling.
  - Forking semantics: a fork copies the parent's recipe in full and the
    forker may edit individual fields. The recipe is a snapshot, not a
    reference — re-running the same recipe months later under a different
    `providerVersion` is supposed to produce a different image and that
    is fine.

- **`pl6.5`** — `app/firehose/chooseNextGeneration.ts`:
  - Reads the last 20 persisted recipes via `app/db/posts.ts` (extend the
    reader if needed for cheap "recent recipes" lookup). The reader
    returns `StoredSubjectTemplateId`-typed values; R-rule application
    filters out T00 rows so the chooser's working window contains only
    `ChooserSubjectTemplateId` shapes.
  - Builds a weighted distribution of style families (uniform, then
    multiplied by R5 downweights).
  - Samples style family (R1 hard-rejects the most recent).
  - Samples subject template from `ChooserSubjectTemplateId` (R2
    hard-rejects last 5; T00 is unreachable by type).
  - For the chosen template, looks up its exact slot-shape from
    `RecipeSubject`'s discriminator and samples each required slot from
    the corresponding vocabulary (R6 soft-downweights last-20 values per
    slot id).
  - Samples provider from the row of the model-assignment table for the
    chosen style family (R3 hard-rejects the most recent provider if >1
    exists).
  - Samples aspect ratio from the policy distribution × style-family
    multipliers (R4 hard-rejects per its restated rule).
  - Composes the final prompt: `<template.fill(slots)>, <style.promptSeed>`,
    where `template.fill(slots)` runs the article-normalization pass over
    `[a/an before slot]` positions (see "Template rendering").
  - Returns a recipe object that satisfies `Generation`'s extended type —
    `createPost` is the writer.

- **`pl6.5` also replaces `pickPrompt.ts`** — the FNV-1a placeholder in the
  firehose is the dumb baseline this design supersedes. The cron handler
  in `app/firehose/scheduled.ts` swaps `pickPrompt → chooseNextGeneration`.

---

## What this design forbids by construction

1. **A generation with a style family or subject template that doesn't
   exist.** `StyleFamily`, `StoredSubjectTemplateId`, and
   `ChooserSubjectTemplateId` are all literal-union types; only the doc's
   values are constructible. Strings carried in D1 are parsed at the read
   boundary into those literal unions ([LAW:no-defensive-null-guards] —
   defenses live at the trust boundary, not inside it).
2. **A recipe whose slots don't match its template.** `RecipeSubject` is a
   discriminated union: each `subjectTemplate` variant carries exactly the
   slot keys its phrase references. `(subjectTemplate: 'T01', slots: {})`
   does not type-check; `(subjectTemplate: 'T05', slots: { setting: 'x' })`
   does not type-check (missing `timeOfDay`). The compiler refuses.
3. **The chooser producing a backfill-only template.** `ChooserSubjectTemplateId`
   is `'T01' | ... | 'T40'` — `'T00'` is not in the union. A chooser that
   tries to return T00 fails at the function's return type. No runtime
   "must not be T00" assertion is needed.
4. **Two consecutive posts in the same style family.** R1 is enforced by
   the chooser; the type `(StyleFamily, RecentPosts)` constructs the
   reject-list before sampling. No callsite branches on "did I already
   pick this style."
5. **A provider receiving non-canonical aspect ratio params.** The chooser
   produces an `AspectRatio` enum value; the provider's `paramsSchema`
   accepts only that enum (fal) or translates via the canonical table
   (sdxl). The (w,h) literal is never the chooser's output.
6. **A prompt with mismatched articles ("a otter", "an cat").** The pl6.5
   renderer normalizes any `a`/`an` immediately preceding a slot using a
   lowercase-first-character vowel-letter heuristic. The template strings
   stay English-readable; the rendering is mechanical.

## What this design accepts (failure modes documented like success paths)

1. **A degenerate feed in the first 5 posts** — R2/R5/R6 degrade. The
   ct9 bootstrap (20 posts) already covers this, but a fresh dev DB will
   produce 3–5 posts of weakly-varied content before steady state.
2. **A style family that the provider executes poorly anyway.** The
   weighting biases provider choice toward the better provider, but
   FLUX-doing-watercolor with 0.3 weight will still fire occasionally
   and may produce poor results. This is acceptable: SDXL would do it
   better but FLUX-doing-watercolor is itself a kind of variety.
3. **A subject template whose slot vocabularies feel exhausted after
   200 posts.** Adding a new vocabulary item is one line; this is
   self-correcting if monitored.

## What is NOT in this design

- LLM-driven prompt generation. We want the editorial voice in the doc,
  not deferred to a model with its own biases.
- Style transfer or img2img (a future epic — variety-pl6 is text-to-image).
- Per-user variety (different feeds for different users — the product is a
  single shared feed for now).
- Quality scoring of outputs (the "did this look good?" loop is a separate
  problem and probably belongs to a future ranking epic).

---

## Open questions deferred to operational metrics

- After 200 posts, is the perceived variety good? If a style family is
  consistently producing weak outputs, do we deprecate it or re-weight
  its provider?
- Are the slot vocabularies the right size? Too small → repetition
  visible within 50 posts; too large → individual items are barely
  represented.
- Should template `Tnn` ids be renamed to something more descriptive once
  the pattern stabilizes? (Argument for: discoverable. Argument against:
  cheap stable identifiers for anti-rep tracking.)

These do not block implementation. They are checks to run once the
firehose is producing content steadily.
