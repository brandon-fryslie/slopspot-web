// [LAW:types-are-the-program] This file is the concrete shape of the variety
// taxonomy from design-docs/variety.md. The doc defined the *intent*; this
// module makes the intent unrepresentable-when-violated:
//
//   - StyleFamily / AspectRatio are literal unions, so a string outside the
//     14 / 5 documented values is a compile error and (via the schemas below)
//     a parse error at the trust boundary.
//   - ChooserSubjectTemplateId vs StoredSubjectTemplateId split per the doc:
//     T00 is the backfill sentinel; the chooser cannot produce it by type.
//   - RecipeSubject is a discriminated union with one variant per template,
//     so (subjectTemplate: 'T05', slots: {}) does not type-check — the slot
//     keys required by each phrase are encoded in the variant, not in a
//     runtime check.
//
// Constants in this file are derived 1:1 from the doc. The consistency test
// (app/lib/__tests__/variety.test.ts) re-extracts placeholders from each phrase
// and asserts they match TEMPLATE_SLOT_KEYS — so a drift between the phrase
// text and its declared slots fails at test time, not at chooser-runtime.
//
// [LAW:one-type-per-behavior] THE PRIMORDIAL GENE POOL. Post-genome (System I),
// this taxonomy is no longer the per-recipe generator — it is the *starting
// alleles* a FOUNDER draws from. After founders, the pool evolves itself: breed
// recombines these alleles into hybrid combinations no one hand-defined and drifts
// the continuous traits, so the city's look becomes selection's, not a designer's.
// The families/templates/frames here are DATA (alleles), never code paths — there
// is no per-family branch anywhere, only Record-indexed lookup. PRIMORDIAL_ALLELES
// (below) names that founding pool for the genes this module owns; the 4th gene,
// medium, is the registry's allele-set (realProviders), cross-referenced — never
// copied here (the registry is the single enforcer for providers).

import { z } from 'zod'

// [LAW:one-source-of-truth] StyleFamily is the canonical aesthetic territory id.
// The doc's 14 families, ids transcribed verbatim. Adding a family is a
// one-line change here + an entry in STYLE_FAMILY_PROMPT_SEEDS; removing one is
// harder because old rows may reference it (prefer leave-and-deprecate).
export const STYLE_FAMILIES = [
  'oil-painting',
  'photoreal',
  'cyberpunk-neon',
  'liminal',
  'low-poly',
  'vaporwave',
  'watercolor',
  'anime',
  'cottagecore',
  'haunted-mundane',
  '1990s-cgi',
  'botanical-illustration',
  'brutalist-architecture',
  'risograph-print',
] as const

export type StyleFamily = (typeof STYLE_FAMILIES)[number]

export const styleFamilySchema = z.enum(STYLE_FAMILIES)

// Prompt seeds per the doc's §Style families table. The chooser concatenates
// the subject phrase with the matching seed to form the final prompt.
export const STYLE_FAMILY_PROMPT_SEEDS: Record<StyleFamily, string> = {
  'oil-painting':
    'oil painting on canvas, visible brushwork, classical composition, museum-piece lighting',
  photoreal:
    'photograph, 35mm lens, natural light, shallow depth of field, color-graded like Kodak Portra',
  'cyberpunk-neon':
    'cyberpunk city at night, neon signage in mixed languages, wet asphalt reflections, dense wiring',
  liminal:
    'empty interior at off-hours, fluorescent overhead lighting, no people, slight wide-angle distortion',
  'low-poly':
    'low-polygon 3D render, untextured or single-texture surfaces, PS1/N64-era, hard vertex shading',
  vaporwave:
    'pink-and-teal palette, marble bust, palm fronds, late-90s computing artifacts, dreamy grid',
  watercolor:
    'watercolor on cold-press paper, soft edge bleeding, washy pigments, paper grain visible',
  anime:
    'anime cel-shading, expressive line work, manga-style composition, flat color fills with one rim light',
  cottagecore:
    'rural pastoral, hand-knit textures, dappled afternoon sun, embroidery and wildflowers, soft-focus',
  'haunted-mundane':
    'everyday scene with one wrong thing, suburban setting, uncanny stillness, eye-level photograph',
  '1990s-cgi':
    'early Pixar / Reboot-era 3D render, plastic shaders, hard rim light, primary-color materials',
  'botanical-illustration':
    'Victorian field-guide plate, ink line work with watercolor wash, Latin label, plain background',
  'brutalist-architecture':
    'monolithic concrete, hard noon light, geometric mass, no people, slightly grainy medium-format',
  'risograph-print':
    'risograph print, limited 2–3 color palette (fluoro pink, teal, black), visible registration drift, paper texture',
}

// [LAW:single-enforcer] AspectRatio is the canonical token; providers translate
// to native (image_size enum / (w,h) tuple) at their boundary. The doc's
// §Aspect ratio policy enumerates exactly these 5.
export const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const
export type AspectRatio = (typeof ASPECT_RATIOS)[number]
export const aspectRatioSchema = z.enum(ASPECT_RATIOS)

// [LAW:one-source-of-truth] Human-readable label fed to LLM system prompts.
// Consumed by the firehose composer and the rewrite-prompt route; one value,
// two callers — a change here propagates to both automatically.
export const ASPECT_RATIO_LABELS: Record<AspectRatio, string> = {
  '1:1': 'square',
  '16:9': 'wide landscape',
  '9:16': 'tall portrait',
  '4:3': 'landscape',
  '3:4': 'portrait',
}

// [LAW:one-source-of-truth] The doc's §Aspect ratio policy distribution. Weights
// are proportional (not probabilities); the weighted sampler normalizes. Kept
// as raw percentages from the doc so a reviewer comparing this file to the
// doc's table sees identical numbers.
export const ASPECT_RATIO_BASE_WEIGHTS: Record<AspectRatio, number> = {
  '1:1': 60,
  '16:9': 20,
  '9:16': 15,
  '4:3': 3,
  '3:4': 2,
}

// [LAW:dataflow-not-control-flow] Every style family carries a bias map, often
// empty. The chooser reads the bias for any (style, ratio) and multiplies — no
// "if style has a bias else use base" branch. The doc only calls out 6 styles
// with 1.5× multipliers; the rest get an empty map that contributes no
// multipliers (the chooser's fold treats absent keys as 1.0).
export const STYLE_FAMILY_ASPECT_BIAS: Record<StyleFamily, Partial<Record<AspectRatio, number>>> = {
  'oil-painting': {},
  photoreal: {},
  'cyberpunk-neon': { '16:9': 1.5, '4:3': 1.5 },
  liminal: { '16:9': 1.5, '4:3': 1.5 },
  'low-poly': {},
  vaporwave: {},
  watercolor: {},
  anime: { '9:16': 1.5, '3:4': 1.5 },
  cottagecore: {},
  'haunted-mundane': {},
  '1990s-cgi': { '9:16': 1.5, '3:4': 1.5 },
  'botanical-illustration': { '9:16': 1.5, '3:4': 1.5 },
  'brutalist-architecture': { '16:9': 1.5, '4:3': 1.5 },
  'risograph-print': {},
}

// [LAW:types-are-the-program] Two SubjectTemplateId types, deliberately split:
// the chooser's return type excludes T00 by construction (the backfill
// sentinel is unreachable when generating new content), and the storage
// read type admits it. A chooser implementation that tries to produce T00
// fails the return-type check — no runtime "must not be T00" assertion.
//
// Stored is a value-level superset of Chooser (it adds only 'T00'), so every
// chooser-produced value is also a valid stored value by assignment.
// Narrowing the other direction (read T00-bearing slice → chooser-shape
// working window) is an explicit .filter() at the call site in pl6.5.
export const CHOOSER_SUBJECT_TEMPLATE_IDS = [
  'T01',
  'T02',
  'T03',
  'T04',
  'T05',
  'T06',
  'T07',
  'T08',
  'T09',
  'T10',
  'T11',
  'T12',
  'T13',
  'T14',
  'T15',
  'T16',
  'T17',
  'T18',
  'T19',
  'T20',
  'T21',
  'T22',
  'T23',
  'T24',
  'T25',
  'T26',
  'T27',
  'T28',
  'T29',
  'T30',
  'T31',
  'T32',
  'T33',
  'T34',
  'T35',
  'T36',
  'T37',
  'T38',
  'T39',
  'T40',
] as const
export type ChooserSubjectTemplateId = (typeof CHOOSER_SUBJECT_TEMPLATE_IDS)[number]

export const STORED_SUBJECT_TEMPLATE_IDS = [
  'T00',
  ...CHOOSER_SUBJECT_TEMPLATE_IDS,
] as const
export type StoredSubjectTemplateId = (typeof STORED_SUBJECT_TEMPLATE_IDS)[number]

export const storedSubjectTemplateIdSchema = z.enum(STORED_SUBJECT_TEMPLATE_IDS)

// [LAW:one-source-of-truth] The primordial gene pool — the founding alleles a founder's
// genes draw from — for the three genes this module owns. REFERENCES the canonical arrays
// above; it is a named VIEW of the founding pool, never a copy (editing a family edits the
// allele set in exactly one place). `form` is the CHOOSER set (T01–T40) — T00 is a backfill
// sentinel no founder can draw, so it is unrepresentable as a primordial form allele by type.
// [LAW:one-way-deps] The 4th gene — `medium` — is the registry's allele-set (realProviders),
// NOT listed here: variety.ts is a pure leaf and must not depend on the provider registry.
// A consumer composing a full founding gene-tuple pulls medium from realProviders(env), the
// registry being the single enforcer for which media exist in an environment.
export const PRIMORDIAL_ALLELES = {
  species: STYLE_FAMILIES,
  form: CHOOSER_SUBJECT_TEMPLATE_IDS,
  frame: ASPECT_RATIOS,
} as const

// Phrases verbatim from the doc's §Subject templates table. The chooser fills
// {slot} placeholders with vocab values and the renderer normalizes any
// a/an immediately preceding a slot per the doc's §Template rendering rules.
//
// Note on T35 ('a {setting} that you can only reach through a {setting}'):
// mechanical extraction yields a single `setting` slot key; both
// placeholders fill with the same value. The recursive output
// ("a motel-corridor that you can only reach through a motel-corridor")
// fits the editorial voice (slightly absurd) — see §Subject templates.
export const TEMPLATE_PHRASES: Record<StoredSubjectTemplateId, string> = {
  T00: '{freeText}',
  T01: 'a {animal} working as a {profession}',
  T02: 'an {animal} performing an act of {emotion}',
  T03: 'the last {profession} of the {era}, retiring',
  T04: 'a {manMadeObject} from the {era}, abandoned in a {setting}',
  T05: '{setting} at {timeOfDay}',
  T06: 'a {naturalObject}, photographed as if it were a {manMadeObject}',
  T07: 'a {manMadeObject}, photographed as if it were a {naturalObject}',
  T08: 'a {animal} thinking about {abstractConcept}',
  T09: 'a vending machine that dispenses {abstractConcept}',
  T10: 'diagram of how a {manMadeObject} actually works (charmingly wrong)',
  T11: 'instructions for using a {manMadeObject} you have never seen',
  T12: 'a {profession} on their first day, posing for a portrait',
  T13: 'the {era} version of a {manMadeObject} that does not yet exist',
  T14: 'a {animal} accepting a small award for {abstractConcept}',
  T15: '{setting}, but it is the {era}',
  T16: 'a still life of {manMadeObject} and {naturalObject}, arranged like a memory',
  T17: 'a {animal} reading a {manMadeObject}',
  T18: 'a {profession} who is secretly a {animal}',
  T19: 'the {abstractConcept} room of a {setting}',
  T20: 'a postcard from a {setting} that is not real',
  T21: 'the saddest {manMadeObject} in the {setting}',
  T22: 'a {animal} that has just learned about {abstractConcept}',
  T23: 'an instruction manual page for {abstractConcept}',
  T24: "a {naturalObject} that is also a {profession}'s workplace",
  T25: "the official {era} portrait of a {animal}, oil-finished even when it isn't oil",
  T26: 'a {manMadeObject} that has been given a small, dignified ceremony',
  T27: 'a community board flyer for an event called {abstractConcept}',
  T28: '{setting}, after closing time, still warm',
  T29: 'a {animal} captured in the act of forgetting',
  T30: 'a {profession} whose only client is a {animal}',
  T31: 'a {manMadeObject} that has outlived its purpose by a wide margin',
  T32: 'a {naturalObject} explained by a {profession} who does not understand it',
  T33: 'a {animal} that has been crowned for an obscure achievement',
  T34: 'a {era} appliance that promises {abstractConcept}',
  T35: 'a {setting} that you can only reach through a {setting}',
  T36: 'a study of {naturalObject}, mounted and labeled by a {profession}',
  T37: "the {abstractConcept} drawer of a {profession}'s desk",
  T38: 'a {animal} that has gone into politics',
  T39: 'a {manMadeObject} found in a {setting} where it does not belong',
  T40: 'a {profession} caught daydreaming about a {naturalObject}',
}

// [LAW:one-source-of-truth] Explicit slot-key list per template, used by
// the chooser to know what to sample and by the variety consistency test to
// verify the phrase ↔ slot list alignment. Each entry is the SET of unique
// placeholder names appearing in TEMPLATE_PHRASES[id] — order is not
// load-bearing because chooseNextGeneration's sampleSlots hashes by slot
// name (not by index), so any permutation produces the same recipe.
// Test in variety.test.ts re-extracts placeholders from each phrase and
// asserts set-equality (sorted) — drift between phrase and slot list fails
// the test.
export const TEMPLATE_SLOT_KEYS = {
  T00: ['freeText'],
  T01: ['animal', 'profession'],
  T02: ['animal', 'emotion'],
  T03: ['profession', 'era'],
  T04: ['manMadeObject', 'era', 'setting'],
  T05: ['setting', 'timeOfDay'],
  T06: ['naturalObject', 'manMadeObject'],
  T07: ['manMadeObject', 'naturalObject'],
  T08: ['animal', 'abstractConcept'],
  T09: ['abstractConcept'],
  T10: ['manMadeObject'],
  T11: ['manMadeObject'],
  T12: ['profession'],
  T13: ['era', 'manMadeObject'],
  T14: ['animal', 'abstractConcept'],
  T15: ['setting', 'era'],
  T16: ['manMadeObject', 'naturalObject'],
  T17: ['animal', 'manMadeObject'],
  T18: ['profession', 'animal'],
  T19: ['abstractConcept', 'setting'],
  T20: ['setting'],
  T21: ['manMadeObject', 'setting'],
  T22: ['animal', 'abstractConcept'],
  T23: ['abstractConcept'],
  T24: ['naturalObject', 'profession'],
  T25: ['era', 'animal'],
  T26: ['manMadeObject'],
  T27: ['abstractConcept'],
  T28: ['setting'],
  T29: ['animal'],
  T30: ['profession', 'animal'],
  T31: ['manMadeObject'],
  T32: ['naturalObject', 'profession'],
  T33: ['animal'],
  T34: ['era', 'abstractConcept'],
  T35: ['setting'],
  T36: ['naturalObject', 'profession'],
  T37: ['abstractConcept', 'profession'],
  T38: ['animal'],
  T39: ['manMadeObject', 'setting'],
  T40: ['profession', 'naturalObject'],
} as const satisfies Record<StoredSubjectTemplateId, readonly SlotId[]>

// [LAW:one-source-of-truth] Slot vocabularies per the doc's §Slot vocabularies
// block. freeText has no vocabulary — it's used only by T00 (backfill).
export const SLOT_VOCABS = {
  animal: [
    'cat',
    'dog',
    'otter',
    'raven',
    'owl',
    'octopus',
    'fennec',
    'capybara',
    'axolotl',
    'salamander',
    'hare',
    'fox',
    'magpie',
    'donkey',
    'badger',
    'peacock',
    'narwhal',
    'pangolin',
    'manatee',
    'heron',
    'marmoset',
  ],
  profession: [
    'surgeon',
    'sommelier',
    'librarian',
    'locksmith',
    'falconer',
    'accountant',
    'beekeeper',
    'archivist',
    'lighthouse-keeper',
    'mortician',
    'cartographer',
    'lexicographer',
    'taxidermist',
    'organist',
    'harbor-pilot',
    'clockmaker',
    'perfumer',
    'cooper',
    'bookbinder',
    'glassblower',
    'claims-adjuster',
  ],
  manMadeObject: [
    'pay-phone',
    'ATM',
    'vending-machine',
    'slot-machine',
    'telegraph',
    'dial-phone',
    'jukebox',
    'fax-machine',
    'microfilm-reader',
    'dictaphone',
    'overhead-projector',
    'cash-register',
    'telex',
    'ham-radio',
    'slide-projector',
    'polaroid-camera',
    'filing-cabinet',
    'rotary-rolodex',
    'ticket-punch',
    'parking-meter',
  ],
  naturalObject: [
    'river',
    'mountain',
    'glacier',
    'fjord',
    'marsh',
    'dune',
    'geyser',
    'mangrove',
    'salt-flat',
    'caldera',
    'oxbow-lake',
    'sinkhole',
    'terraced-hillside',
    'peat-bog',
    'tide-pool',
    'cloud-bank',
    'kelp-forest',
    'granite-outcrop',
  ],
  setting: [
    'motel-corridor',
    'suburban-cul-de-sac',
    'abandoned-mall',
    'hospital-waiting-room',
    'gas-station',
    'subway-platform',
    'lobby-of-a-regional-bank',
    'reception-of-a-DMV',
    'indoor-pool-after-hours',
    'school-gymnasium-stage',
    'parking-garage-stairwell',
    'public-library-mezzanine',
    'conference-hotel-bar',
    'airport-chapel',
    'rural-funeral-home',
    'community-center-basement',
  ],
  timeOfDay: [
    'golden-hour',
    'blue-hour',
    'just-after-sunrise',
    'late-afternoon-flat-light',
    'noon',
    'deep-night',
    'dawn-with-fog',
    'the-hour-after-it-rains',
  ],
  era: [
    '1970s',
    '1990s',
    'Edwardian',
    'late-Soviet',
    'post-9/11-Y2K',
    'antebellum',
    'Edo-period',
    'interwar',
    '1980s-mall-era',
  ],
  emotion: [
    'melancholy',
    'tender',
    'anxious',
    'content',
    'awestruck',
    'suspicious',
    'weary',
    'reverent',
    'sheepish',
    'embarrassed',
    'delighted-but-trying-not-to-show-it',
    'gently-baffled',
  ],
  abstractConcept: [
    'patience',
    'regret',
    'almost-remembrance',
    'feeling-of-clean-laundry',
    'small-victories',
    'vocational-pride',
    'second-half-of-an-anecdote',
    'bureaucratic-grace',
    'hospitality',
    'passage-of-time',
    'residual-warmth',
    'permission',
    'archival-care',
  ],
} as const

export type SlotId = keyof typeof SLOT_VOCABS | 'freeText'

// [LAW:types-are-the-program] RecipeSubject is the discriminated union from the
// doc's §Implementation seams. One variant per template id; each variant's
// `slots` object types exactly the keys its phrase references. The compiler
// refuses (subjectTemplate: 'T05', slots: { setting: 'x' }) — missing timeOfDay
// is unrepresentable. No bag-of-optionals, no runtime "did you supply all the
// slots" check.
//
// Spelled out as 41 explicit z.object variants rather than generated via a
// helper because (a) the type system holds each variant's exact literal
// discriminator and exact slot keys, and (b) reading the file you see the
// shape of every template at once, which matches the doc's table.
export const recipeSubjectSchema = z.discriminatedUnion('subjectTemplate', [
  z.object({
    subjectTemplate: z.literal('T00'),
    // T00.slots.freeText carries the legacy/backfill prompt verbatim — the
    // max matches fal-flux's paramsSchema prompt cap (500) since the
    // backfilled rows' params_json.prompt was bounded by the same limit at
    // write-time. T01-T40 slots hold vocab items (longest ~36 chars), so the
    // tighter 100-char cap on those rejects pathological inputs without
    // truncating any legitimate vocab value.
    slots: z.object({ freeText: z.string().min(1).max(500) }).strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T01'),
    slots: z
      .object({ animal: z.string().min(1).max(100), profession: z.string().min(1).max(100) })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T02'),
    slots: z
      .object({ animal: z.string().min(1).max(100), emotion: z.string().min(1).max(100) })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T03'),
    slots: z
      .object({ profession: z.string().min(1).max(100), era: z.string().min(1).max(100) })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T04'),
    slots: z
      .object({
        manMadeObject: z.string().min(1).max(100),
        era: z.string().min(1).max(100),
        setting: z.string().min(1).max(100),
      })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T05'),
    slots: z
      .object({ setting: z.string().min(1).max(100), timeOfDay: z.string().min(1).max(100) })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T06'),
    slots: z
      .object({
        naturalObject: z.string().min(1).max(100),
        manMadeObject: z.string().min(1).max(100),
      })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T07'),
    slots: z
      .object({
        manMadeObject: z.string().min(1).max(100),
        naturalObject: z.string().min(1).max(100),
      })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T08'),
    slots: z
      .object({
        animal: z.string().min(1).max(100),
        abstractConcept: z.string().min(1).max(100),
      })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T09'),
    slots: z.object({ abstractConcept: z.string().min(1).max(100) }).strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T10'),
    slots: z.object({ manMadeObject: z.string().min(1).max(100) }).strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T11'),
    slots: z.object({ manMadeObject: z.string().min(1).max(100) }).strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T12'),
    slots: z.object({ profession: z.string().min(1).max(100) }).strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T13'),
    slots: z
      .object({ era: z.string().min(1).max(100), manMadeObject: z.string().min(1).max(100) })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T14'),
    slots: z
      .object({
        animal: z.string().min(1).max(100),
        abstractConcept: z.string().min(1).max(100),
      })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T15'),
    slots: z
      .object({ setting: z.string().min(1).max(100), era: z.string().min(1).max(100) })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T16'),
    slots: z
      .object({
        manMadeObject: z.string().min(1).max(100),
        naturalObject: z.string().min(1).max(100),
      })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T17'),
    slots: z
      .object({ animal: z.string().min(1).max(100), manMadeObject: z.string().min(1).max(100) })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T18'),
    slots: z
      .object({ profession: z.string().min(1).max(100), animal: z.string().min(1).max(100) })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T19'),
    slots: z
      .object({
        abstractConcept: z.string().min(1).max(100),
        setting: z.string().min(1).max(100),
      })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T20'),
    slots: z.object({ setting: z.string().min(1).max(100) }).strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T21'),
    slots: z
      .object({ manMadeObject: z.string().min(1).max(100), setting: z.string().min(1).max(100) })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T22'),
    slots: z
      .object({
        animal: z.string().min(1).max(100),
        abstractConcept: z.string().min(1).max(100),
      })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T23'),
    slots: z.object({ abstractConcept: z.string().min(1).max(100) }).strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T24'),
    slots: z
      .object({
        naturalObject: z.string().min(1).max(100),
        profession: z.string().min(1).max(100),
      })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T25'),
    slots: z
      .object({ era: z.string().min(1).max(100), animal: z.string().min(1).max(100) })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T26'),
    slots: z.object({ manMadeObject: z.string().min(1).max(100) }).strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T27'),
    slots: z.object({ abstractConcept: z.string().min(1).max(100) }).strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T28'),
    slots: z.object({ setting: z.string().min(1).max(100) }).strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T29'),
    slots: z.object({ animal: z.string().min(1).max(100) }).strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T30'),
    slots: z
      .object({ profession: z.string().min(1).max(100), animal: z.string().min(1).max(100) })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T31'),
    slots: z.object({ manMadeObject: z.string().min(1).max(100) }).strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T32'),
    slots: z
      .object({
        naturalObject: z.string().min(1).max(100),
        profession: z.string().min(1).max(100),
      })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T33'),
    slots: z.object({ animal: z.string().min(1).max(100) }).strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T34'),
    slots: z
      .object({ era: z.string().min(1).max(100), abstractConcept: z.string().min(1).max(100) })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T35'),
    slots: z.object({ setting: z.string().min(1).max(100) }).strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T36'),
    slots: z
      .object({
        naturalObject: z.string().min(1).max(100),
        profession: z.string().min(1).max(100),
      })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T37'),
    slots: z
      .object({
        abstractConcept: z.string().min(1).max(100),
        profession: z.string().min(1).max(100),
      })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T38'),
    slots: z.object({ animal: z.string().min(1).max(100) }).strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T39'),
    slots: z
      .object({ manMadeObject: z.string().min(1).max(100), setting: z.string().min(1).max(100) })
      .strict(),
  }),
  z.object({
    subjectTemplate: z.literal('T40'),
    slots: z
      .object({
        profession: z.string().min(1).max(100),
        naturalObject: z.string().min(1).max(100),
      })
      .strict(),
  }),
])

export type RecipeSubject = z.infer<typeof recipeSubjectSchema>

// [LAW:types-are-the-program] The chooser's return type narrows RecipeSubject to
// exclude T00 — by construction, not by assertion. Per the design doc:
//   "The chooser's return type uses ChooserSubjectTemplateId; the recipe
//    parser (D1 read path) uses StoredSubjectTemplateId."
// `Exclude` removes the T00 variant from the discriminated union, leaving the
// 40 T01–T40 variants. A chooser implementation that tries to return T00 fails
// the function's return type — no runtime "must not be T00" assertion is
// needed.
export type ChooserRecipeSubject = Exclude<RecipeSubject, { subjectTemplate: 'T00' }>

// [LAW:single-enforcer] The article-normalization renderer from the doc's
// §Template rendering. One scan over the phrase: any `a` or `an` immediately
// preceding a `{slot}` gets replaced with the article matching the resolved
// value's first character (lowercased; vowel-letter → `an`, else → `a`).
// Other articles (before literal words like "act", "instructions") pass
// through verbatim.
//
// Used by the firehose stub today and by pl6.5's chooser when it composes
// final prompts. The renderer accepts any RecipeSubject — T00 (single
// {freeText} slot) renders as just the freeText string with no article
// rewriting; T01–T40 follow the article rule.
// [LAW:one-source-of-truth] The a/an choice for a value is one rule with one
// home. renderTemplate's inline article logic and sceneForWish's embalmed-motif
// phrases (an `otter`-shaped fixture vs a `cat`-shaped fixture) must agree, so the
// rule lives here and both read it.
export function indefiniteArticle(value: string): 'a' | 'an' {
  return 'aeiou'.includes(value.charAt(0).toLowerCase()) ? 'an' : 'a'
}

export function renderTemplate(subject: RecipeSubject): string {
  const phrase = TEMPLATE_PHRASES[subject.subjectTemplate]
  const slots = subject.slots as Record<string, string>
  // Match `\b(a|an)\s+\{slot\}` and replace the article+slot together so the
  // article is chosen by the resolved value's first character. Other `{slot}`
  // occurrences (no preceding article) substitute the value verbatim.
  return phrase
    .replace(/\b(a|an)\s+\{(\w+)\}/g, (_match, _article, slot) => {
      const value = slots[slot]
      return `${indefiniteArticle(value)} ${value}`
    })
    .replace(/\{(\w+)\}/g, (_match, slot) => slots[slot])
}

// ─────────────────────────────────────────────────────────────────────────────
// sceneForWish — move-7 / scene-not-menagerie (slopspot-well-foundation-3aj.13)
//
// THE PROBLEM: move-5 re-slotted the recipe subject to be the SCENE a wished relic
// is mounted in (wish-occasion only). But ~12 of the 40 templates carry an {animal}
// slot, so move-5 promotes a FAUNA template into the scene and Haiku faithfully
// renders a LIVE second creature — render-noise that gets promoted on no-negative
// providers, and a re-opened two-competing-subjects when the recipe subject is
// itself a creature. The Dilettante's "anything that breathes" PROSE clause got
// ROUTED AROUND: Haiku kept the creature and narrated it as "background".
//
// THE FIX IS THE WIRING, NOT A SENTENCE. Because RecipeSubject is a typed
// discriminated union, the {animal}-bearing variants are a compile-time-knowable
// SUBSET (AnimalTemplateId, derived below from TEMPLATE_SLOT_KEYS — never a second
// hand-kept list). sceneForWish keys on that TYPE (subject.subjectTemplate), not on
// the {animal} VALUE, and produces the scene string that replaces renderTemplate at
// the wish-assembly seam in composer.ts. A creature recipe-subject can then never
// reach the render as a LIVING co-subject — it is embalmed into the setting as an
// inanimate motif, or it recedes to pure setting.
// [LAW:types-are-the-program] [LAW:dataflow-not-control-flow] [LAW:one-source-of-truth]
// ─────────────────────────────────────────────────────────────────────────────

// [LAW:one-source-of-truth] The {animal}-bearing template set is DERIVED from the
// single source of truth (TEMPLATE_SLOT_KEYS), never re-listed by hand. Add an
// {animal} slot to a new template and AnimalTemplateId widens automatically — the
// WISH_ANIMAL_SCENES Record below then fails to compile until the new template is
// handled, so "an animal template with no wish transform" is an unrepresentable
// state, not a silent gap. [LAW:types-are-the-program]
export type AnimalTemplateId = {
  [K in StoredSubjectTemplateId]: 'animal' extends (typeof TEMPLATE_SLOT_KEYS)[K][number]
    ? K
    : never
}[StoredSubjectTemplateId]

// Each builder receives ONLY its own variant's typed slots, so a phrase can read
// exactly the non-animal structure (profession/place/occasion) the template paints
// and embalm-or-drop the animal actor.
type AnimalWishSceneBuilders = {
  [K in AnimalTemplateId]: (slots: Extract<RecipeSubject, { subjectTemplate: K }>['slots']) => string
}

// CD-BLESSED scene mapping — slopspot-well-foundation-3aj.13 (round-12 verdict).
// The structure (type-keyed dispatch, exhaustive Record, embalm-vs-recede split) and
// these strings are blessed with four refinements baked in:
//  (1) the 8 EMBALM scenes: the wished creature is the embalmed/petrified relic in the
//      scene; the template-animal survives only as an inanimate motif of the setting.
//  (2) the 4 RECEDE scenes (T02/T08/T22/T29) DROP the animal but land the relic in a
//      real PLACE — a room, not a mood/fog. An under-specified scene lets the relic
//      dissolve, so each names a concrete shuttered interior.
//  (3) the template-animal becomes an OBJECT / FIXTURE, never a second SPECIMEN —
//      subordinate and small. The WISHED creature is the ONLY embalmed-creature-relic.
//  (4) the inanimate form is BREADTH-VARIED across templates so the feed does not
//      rhyme: fixture / finial / bookend / effigy / bust / weathervane / heraldic
//      device / statue — eight distinct motifs, none reused.
// "Keep the world, petrify-or-drop the actor."
const WISH_ANIMAL_SCENES: AnimalWishSceneBuilders = {
  // EMBALM — a concrete world/occasion survives; the animal is a small inanimate motif.
  T01: (s) =>
    `the deserted workplace of ${indefiniteArticle(s.profession)} ${s.profession}, ${indefiniteArticle(s.animal)} ${s.animal}-shaped fixture left among the tools`,
  T14: (s) =>
    `a small award ceremony for ${s.abstractConcept}, the empty plinth topped with a brass ${s.animal} finial`,
  T17: (s) =>
    `a still reading-nook with ${indefiniteArticle(s.manMadeObject)} ${s.manMadeObject}, ${indefiniteArticle(s.animal)} ${s.animal}-shaped bookend beside it`,
  T18: (s) =>
    `the workplace of ${indefiniteArticle(s.profession)} ${s.profession}, ${indefiniteArticle(s.animal)} ${s.animal}-shaped effigy among their things`,
  T25: (s) =>
    `an official ${s.era} portrait hall, the frame holding an oil-finished ${s.animal}-shaped bust`,
  T30: (s) =>
    `the practice of ${indefiniteArticle(s.profession)} ${s.profession}, a tarnished ${s.animal}-shaped weathervane over the door, the client's chair empty`,
  T33: (s) =>
    `a coronation dais for an obscure achievement, the empty throne's crest ${indefiniteArticle(s.animal)} ${s.animal}-shaped heraldic device`,
  T38: (s) =>
    `a political chamber, a tarnished ${s.animal}-shaped statue tucked in a niche off the empty floor`,
  // RECEDE — only an abstract/emotion residue remains; the animal drops and the relic
  // lands in a concrete shuttered PLACE, never a mood.
  T02: (s) => `an abandoned room, the residue of ${s.emotion}`,
  T08: (s) => `a quiet study, ${s.abstractConcept} long contemplated`,
  T22: () => `a hushed room, the aftermath`,
  T29: () => `a cleared, shuttered hall, the residue of being forgotten`,
}

// [LAW:dataflow-not-control-flow] The per-call dispatch is a single lookup-invoke
// over EVERY template — no branch on template kind. The variability is the VALUE in
// this table: the 12 {animal} templates carry their embalm/recede transform, every
// other template (incl T00) carries the identity (renderTemplate, scene byte-
// identical to before). The lone conditional lives at table CONSTRUCTION below
// (building data once at module load), never in the per-invocation path.
// [LAW:one-source-of-truth] This total table is DERIVED from WISH_ANIMAL_SCENES, not
// a second hand-kept list — and because the animal transforms are authored as
// Record<AnimalTemplateId> (exhaustive over the derived animal subset), a future
// {animal} template with no transform is a COMPILE ERROR there, never silently
// caught by the renderTemplate identity default here. [LAW:types-are-the-program]
const SCENE_FOR_WISH: Record<StoredSubjectTemplateId, (subject: RecipeSubject) => string> =
  Object.fromEntries(
    STORED_SUBJECT_TEMPLATE_IDS.map((id) => [
      id,
      id in WISH_ANIMAL_SCENES
        ? // [LAW:types-are-the-program] exception: TS cannot correlate the discriminator
          // with the matching slots variant across an index access (the "correlated
          // union" limitation). The key and the slots come from the SAME subject by
          // construction, so this single localized cast is sound.
          (subject: RecipeSubject) =>
            (WISH_ANIMAL_SCENES[id as AnimalTemplateId] as (slots: RecipeSubject['slots']) => string)(
              subject.slots,
            )
        : renderTemplate,
    ]),
  ) as Record<StoredSubjectTemplateId, (subject: RecipeSubject) => string>

export function sceneForWish(subject: RecipeSubject): string {
  return SCENE_FOR_WISH[subject.subjectTemplate](subject)
}

// [LAW:one-source-of-truth] The single derivation of a placard NAME from a recipe
// subject. Three sites need "a name when no citizen authored one" — the composer
// when Haiku is unavailable, the fork/direct-API write paths that have no LLM
// naming step, and the read boundary for legacy rows predating the title column —
// and they MUST agree, so the derivation lives once, here, beside renderTemplate
// (its only dependency).
//
// [LAW:one-source-of-truth] "A placard is short" is one invariant with one cap,
// owned where the placard concept lives. Both the composer's LLM-authored title and
// the deterministic fallback below pass through capPlacard, so no naming path — not
// Haiku, not the fallback, not a legacy T00 row whose freeText runs to 500 chars —
// can produce an oversized card title.
export const PLACARD_TITLE_MAX = 80

export function capPlacard(title: string): string {
  if (title.length <= PLACARD_TITLE_MAX) return title
  // Cut back to the last word boundary inside the cap so a placard never ends
  // mid-word; fall back to a hard slice if a single token exceeds the cap.
  const cut = title.slice(0, PLACARD_TITLE_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()
}

// [LAW:no-silent-fallbacks] The last-resort placard for a degenerate subject whose
// rendered form is all-whitespace (only reachable via a direct-API T00 with a
// whitespace-only freeText — recipeSubjectSchema enforces min(1), not non-blank; the
// chooser never emits T00). In-voice for the city register (a pawnshop names even
// its nameless junk), never the empty string and never 'Untitled'.
export const UNNAMED_PLACARD = 'Unsigned Relic'

// [LAW:types-are-the-program] fallbackTitle is TOTAL: every subject yields a
// non-empty, visible placard. It is the rendered subject, article-stripped, whitespace-
// collapsed, title-cased ("a derelict lighthouse at dusk" → "Derelict Lighthouse At
// Dusk"), capped to placard length; if nothing survives (an all-whitespace subject) it
// is UNNAMED_PLACARD. Deterministic in the subject, so the same row always derives the
// same name.
export function fallbackTitle(subject: RecipeSubject): string {
  // Collapse + trim FIRST, then strip the leading article: T00 freeText is returned
  // verbatim, so a leading-whitespace value ("  a derelict …") must be normalized
  // before `^(a|an|the)` can match.
  const normalized = renderTemplate(subject).replace(/\s+/g, ' ').trim()
  const stripped = normalized.replace(/^(a|an|the)\s+/i, '')
  // Capitalize each WORD's first letter only — anchored at start or whitespace, so
  // "surgeon's" stays "Surgeon's" rather than "Surgeon'S" (\b\w would fire after the
  // apostrophe too).
  const titled = stripped.replace(/(^|\s)(\w)/g, (_m, lead, ch) => lead + ch.toUpperCase())
  const capped = capPlacard(titled)
  return capped.length > 0 ? capped : UNNAMED_PLACARD
}
