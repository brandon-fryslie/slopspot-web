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
of the abstract dimension into the concrete tables.

The downstream tickets should be **mechanical** after this lands:

- `pl6.2` should be a one-file change adding `styleFamily: StyleFamily` and
  `subjectTemplate: SubjectTemplateId` (and the slot record) to the
  `Generation` type's `recipe`, where those names are literal copies of the
  identifiers below.
- `pl6.5` should be a chooser that, given the last N persisted posts,
  selects one tuple `(styleFamily, subjectTemplate, slotFills, providerId,
  aspectRatio)` according to the weights and anti-repetition rules below.
  No new policy decisions; every check is already named here.

[LAW:types-are-the-program] — the point of this doc is to make the
constraints concrete enough that the *type* of a `Generation.recipe` is
exactly the shape of legal variability. Once the enums exist, a malformed
generation (style family that doesn't exist, subject template the chooser
couldn't have produced) is unrepresentable.

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
| `botanical-illustration`    | Botanical illustration     | `Victorian field-guide plate, ink line work with watercolor wash, latin label, plain background` |
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

Forty templates, each a string with `{slot}` placeholders. Slots are filled
from vocabularies (next section) at chooser time. The composed phrase is the
*subject* — what the image is "of." The style family's prompt seed is then
appended (or prepended, per provider quirks) to produce the final prompt.

Each template has an `id` (used by the chooser for anti-repetition tracking)
and a `phrase` (the slot string).

```
T01  "a {animal} working as a {profession}"
T02  "an {animal} performing an act of {emotion}"
T03  "the last {profession} of the {era}, retiring"
T04  "a {man-made-object} from the {era}, abandoned in a {setting}"
T05  "{setting} at {time-of-day}"
T06  "a {natural-object}, photographed as if it were a {man-made-object}"
T07  "a {man-made-object}, photographed as if it were a {natural-object}"
T08  "a {animal} thinking about {abstract-concept}"
T09  "a vending machine that dispenses {abstract-concept}"
T10  "diagram of how a {man-made-object} actually works (charmingly wrong)"
T11  "instructions for using a {man-made-object} you have never seen"
T12  "a {profession} on their first day, posing for a portrait"
T13  "the {era} version of a {man-made-object} that does not yet exist"
T14  "a {animal} that has been awarded a {abstract-concept}"
T15  "{setting}, but it is the {era}"
T16  "a still life of {man-made-object} and {natural-object}, arranged like a memory"
T17  "a {animal} reading a {man-made-object}"
T18  "a {profession} who is secretly a {animal}"
T19  "the {abstract-concept} room of a {setting}"
T20  "a postcard from a {setting} that is not real"
T21  "the saddest {man-made-object} in the {setting}"
T22  "a {animal} that has just learned about {abstract-concept}"
T23  "an instruction manual page for {abstract-concept}"
T24  "a {natural-object} that is also a {profession}'s workplace"
T25  "the official {era} portrait of {animal}, oil-finished even when it isn't oil"
T26  "a {man-made-object} that has been given a small, dignified ceremony"
T27  "a community board flyer for an event called {abstract-concept}"
T28  "{setting}, after closing time, still warm"
T29  "a {animal} captured in the act of forgetting"
T30  "a {profession} whose only client is a {animal}"
T31  "a {man-made-object} that has outlived its purpose by a wide margin"
T32  "a {natural-object} explained by a {profession} who does not understand it"
T33  "a {animal} that has been crowned for an obscure achievement"
T34  "a {era} appliance that promises an {abstract-concept}"
T35  "a {setting} that exists only between two other {setting}s"
T36  "a study of {natural-object}, mounted and labeled by a {profession}"
T37  "the {abstract-concept} drawer of a {profession}'s desk"
T38  "a {animal} that has gone into politics"
T39  "a {man-made-object} found in a {setting} where it does not belong"
T40  "a {profession} caught daydreaming about a {natural-object}"
```

The templates are intentionally **slightly absurd**. SlopSpot is an aggregator
for AI-generated content and a low-key argument about AI authorship — the
content should have a strong editorial voice, not produce stock photography.
A literal template like "a cat" makes a forgettable image; "a fennec working
as a lighthouse-keeper, captured in the act of forgetting" makes an image
worth scrolling.

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

man-made-object
  pay-phone, ATM, vending-machine, slot-machine, telegraph, dial-phone,
  jukebox, fax-machine, microfilm-reader, dictaphone, overhead-projector,
  cash-register, telex, ham-radio, slide-projector, polaroid-camera,
  filing-cabinet, rotary-rolodex, ticket-punch, parking-meter

natural-object
  river, mountain, glacier, fjord, marsh, dune, geyser, mangrove, salt-flat,
  caldera, oxbow-lake, sinkhole, terraced-hillside, peat-bog, tide-pool,
  cloud-bank, kelp-forest, granite-outcrop

setting
  motel-corridor, suburban-cul-de-sac, abandoned-mall, hospital-waiting-room,
  gas-station, subway-platform, lobby-of-a-regional-bank,
  reception-of-a-DMV, indoor-pool-after-hours, school-gymnasium-stage,
  parking-garage-stairwell, public-library-mezzanine, conference-hotel-bar,
  airport-chapel, rural-funeral-home, community-center-basement

time-of-day
  golden-hour, blue-hour, just-after-sunrise, late-afternoon-flat-light,
  noon, deep-night, dawn-with-fog, the-hour-after-it-rains

era
  1970s, 1990s, Edwardian, late-Soviet, post-9/11-Y2K, antebellum,
  Edo-period, interwar, 1980s-mall-era

emotion
  melancholy, tender, anxious, content, awestruck, suspicious, weary,
  reverent, sheepish, embarrassed, delighted-but-trying-not-to-show-it,
  gently-baffled

abstract-concept
  patience, regret, almost-rememberance, the-feeling-of-clean-laundry,
  small-victories, vocational-pride, the-second-half-of-an-anecdote,
  bureaucratic-grace, hospitality, the-passage-of-time, residual-warmth,
  permission, archival-care
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

- `fal-flux`: native categorical (`aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'`).
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
*never* output (w,h) directly.

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
| R4   | last 2  | `aspectRatio` must not be the same as the *previous two* posts' aspect ratios.     |
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
  - `StyleFamily` literal-union type with the 14 ids above. `SubjectTemplateId`
    literal-union over `T01`–`T40`. `Slots` record (`{ animal?: string;
    profession?: string; ... }`, one optional field per slot vocabulary).
    `AspectRatio` literal-union over `'1:1' | '16:9' | '9:16' | '4:3' | '3:4'`.
  - The `Generation` type (the recipe — `Content.kind === 'generation'` carries
    `recipe: Generation`) gains four fields: `styleFamily`, `subjectTemplate`,
    `slots`, and `aspectRatio`. These join the existing `providerId`,
    `providerVersion`, `params: unknown`, `parentId?`.
  - **Lifting `aspectRatio` is a migration**, not an addition. Today
    `app/providers/fal-flux.ts`'s `paramsSchema` carries `aspectRatio`
    inside `params`. pl6.2 removes it from the provider's `paramsSchema`
    and adds it to `Generation` so the chooser can read it back for R4
    without peeking into `params: unknown`. The provider layer becomes a
    pure translator from canonical `AspectRatio` to provider-native
    `aspectRatio`/`(w,h)`. [LAW:one-source-of-truth] — one canonical
    representation, providers translate at their boundary.
    - Callers updated: `seed.ts` (currently mints fixture recipes),
      `createPost` (writes the recipe to D1), `api.generate.ts` (the
      external action — its `bodySchema.params` now excludes aspectRatio
      and accepts an `aspectRatio` field on the input directly).
  - D1 schema: add columns to the `generations` table (`style_family TEXT
    NOT NULL`, `subject_template TEXT NOT NULL`, `slots JSON NOT NULL`,
    `aspect_ratio TEXT NOT NULL`). Existing rows backfilled with a sentinel
    style (`'photoreal'`), the literal prompt re-parsed as a `T05`
    setting+time template with empty slots, and the previous aspect ratio
    read out of `params`. The bootstrap content load (`ct9`) is the only
    pre-existing data; backfilling 20 rows by hand is acceptable here.
  - Forking semantics: a fork copies the parent's recipe in full and the
    forker may edit individual fields. The recipe is a snapshot, not a
    reference — re-running the same recipe months later under a different
    `providerVersion` is supposed to produce a different image and that
    is fine.

- **`pl6.5`** — `app/firehose/chooseNextGeneration.ts`:
  - Reads the last 20 posts via `app/db/posts.ts` (extend the reader if
    needed for cheap "recent recipes" lookup).
  - Builds a weighted distribution of style families (uniform, then
    multiplied by R5 downweights).
  - Samples style family (R1 hard-rejects the most recent).
  - Samples subject template (R2 hard-rejects last 5).
  - Samples slot-fills from vocabularies (R6 soft-downweights last-20 slot
    values).
  - Samples provider from the row of the model-assignment table for the
    chosen style family (R3 hard-rejects the most recent provider if >1
    exists).
  - Samples aspect ratio from the policy distribution × style-family
    multipliers (R4 hard-rejects last 2 ratios).
  - Composes the final prompt: `<style.promptSeed>, <template.fill(slots)>`.
  - Returns `{ providerId, params, recipe }` — `createPost` is the writer.

- **`pl6.5` also replaces `pickPrompt.ts`** — the FNV-1a placeholder in the
  firehose is the dumb baseline this design supersedes. The cron handler
  in `app/firehose/scheduled.ts` swaps `pickPrompt → chooseNextGeneration`.

---

## What this design forbids by construction

1. **A generation with a style family or subject template that doesn't
   exist.** The `StyleFamily` and `SubjectTemplateId` types are literal
   unions; only the doc's values are constructible. (Strings carried in
   D1 are parsed at the trust boundary into those literal unions —
   [LAW:no-defensive-null-guards] inside the trust boundary.)
2. **Two consecutive posts in the same style family.** R1 is enforced by
   the chooser; the type `(StyleFamily, RecentPosts)` constructs the
   reject-list before sampling. No callsite branches on "did I already
   pick this style."
3. **A provider receiving non-canonical aspect ratio params.** The chooser
   produces an `AspectRatio` enum value; the provider's `paramsSchema`
   accepts only that enum (fal) or translates via the canonical table
   (sdxl). The (w,h) literal is never the chooser's output.

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
