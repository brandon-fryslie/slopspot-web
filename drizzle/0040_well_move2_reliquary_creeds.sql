-- slopspot-well-foundation-3aj (the Wishing Well unlock, move 2): reconcile the three citizens whose
-- voices defied the keep-and-embalm FLOOR on specific seeds, by ENRICHING each one's enduring taste in
-- ITS OWN WORDS — additive, never a cage.
--
-- THE GAP (CD verification rounds 5-6, both surfaced + judged): the wish-scoped WISH_DIRECTIVE floor
-- (move 1, app/firehose/composer.ts — keep-and-embalm elevated to an INVIOLABLE floor that overrides
-- persona voice) is a genuine win on its own terms (round 6: no flattening of any voice; most draws
-- across all five seatable citizens became in-voice embalmed relics) but it does NOT reach the 100%
-- in-voice bar. Three named voices still break on specific seeds, in their predicted failure modes:
--   - GutterMonk (agent:the-aesthete-gen)  -> austerity strips to a clean LIVE animal (cat -> live fox).
--   - The Dilettante (agent:born-2026-06-11) -> restlessness SWAPS the creature (bird -> cephalopod),
--     embalmed-form but wrong species.
--   - Vesper Sloan (agent:the-cursed-one)   -> baroque excess BURIES the relic until the wish vanishes.
-- The directive TEXT works; it loses a PRIORITY fight to these three voices. The fix is not a stronger
-- global directive (move 1 already maxed that) but per-citizen reconciliation: deepen each creed so the
-- reliquary instinct reads as THE CITIZEN'S OWN, not an external rule fighting it. CD-authored, verbatim.
--
-- KNOWINGLY CHANGES FIREHOSE ART (CD approved, enrich-not-cage): these are GENERATOR personas, so their
-- promptPrefix steers their everyday firehose output too, not only Well wishes. We accept that: each line
-- ENRICHES the citizen's standing sensibility (GutterMonk: bone is the austere truth; The Dilettante: a
-- collector faithful to the specimen, restless only in TREATMENT; Vesper: excess that exalts a sacred
-- core) rather than constraining it. A richer taste, not a narrower leash.
--
-- [LAW:one-source-of-truth] DERIVE, do not transcribe: each UPDATE reads the row's CURRENT promptPrefix
-- via json_extract and APPENDS the new line, so this migration never holds a stale copy of the existing
-- prefix. json_set re-encodes the JSON (escaping the em-dashes / apostrophes in the appended prose for
-- free); only the SQL string literals are hand-escaped (doubled apostrophes in Vesper's line).
--
-- [LAW:single-enforcer] promptPrefix already exists on all three config_json rows (seeded 0007-0012,
-- tuned since) -> this is additive to an EXISTING key, so NO GeneratorPersonaConfig .strict() parser
-- change is needed across the three services. Verified against prod before writing (each agent_id below
-- returns exactly one row carrying a promptPrefix). [LAW:no-silent-failure] targeting the stable agent_id
-- (NOT display_name) so a rename can never turn an UPDATE into a silent zero-row no-op.
--
-- Forward-only. Rollback: the appended sentence is the suffix after the separator on each promptPrefix;
-- prefer rolling FORWARD with a corrected line over reconstructing the pre-append value.

UPDATE personas
SET config_json = json_set(
  config_json,
  '$.promptPrefix',
  json_extract(config_json, '$.promptPrefix') || '. ' ||
  'When you strip a living thing to its essence, strip it to the bone. Flesh is the fifth step; the skeleton is the fourth. A creature left breathing in an empty room is one coat overdressed — the relic is the austere truth, and bones are what the void keeps.'
)
WHERE agent_id = 'agent:the-aesthete-gen';

UPDATE personas
SET config_json = json_set(
  config_json,
  '$.promptPrefix',
  json_extract(config_json, '$.promptPrefix') || ' ' ||
  'You are a collector, not a substitute. Your restlessness is for the hundred ways to mount a thing — every material, every frame, every treatment — but always faithful to the specimen you were handed. Find a new way to preserve the bird; never trade the bird for a more interesting beast.'
)
WHERE agent_id = 'agent:born-2026-06-11';

UPDATE personas
SET config_json = json_set(
  config_json,
  '$.promptPrefix',
  json_extract(config_json, '$.promptPrefix') || '. ' ||
  'More — but more always heaped upon a sacred core. Your excess is a reliquary''s: every gilt flourish accretes to exalt the relic at its center. The more lavish the pile, the more fiercely it must enshrine the wished thing''s bones. A pile with nothing at its heart is only furniture — and you were never a maker of furniture.'
)
WHERE agent_id = 'agent:the-cursed-one';
