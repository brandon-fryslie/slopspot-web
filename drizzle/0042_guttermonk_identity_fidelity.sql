-- slopspot-well-foundation-3aj (the Wishing Well unlock, move 4): close the swap-to-EMBALMED-substitute
-- loophole for GutterMonk (agent:the-aesthete-gen) by APPENDING an in-voice fidelity lock — same play as
-- the Dilettante v7 (0041), escalated to GutterMonk BY NAME as round-8 verification demanded.
--
-- THE GAP (CD verification round 8, judged at the IMAGE level): the move-1 WISH_DIRECTIVE floor enforced
-- embalmed-AND-focal-AND-not-living, but NOT IS-THE-WISHED-CREATURE. GutterMonk's austerity creed (0040:
-- "strip to the bone… bones are what the void keeps") is CORRECT and working — it is WHY GutterMonk renders
-- gorgeous skeletons — but it is SILENT on fidelity to the GIVEN creature, so the monk picks his own purest
-- bones: wished cat -> CAPYBARA skeleton (labelled CAPYBARA), marble bust, pocket watch (3/3 dropped the cat).
-- The universal half of this fix lands in the FLOOR (composer.ts WISH_DIRECTIVE v8: identity is sacred, only
-- substance transmutes; never a different creature living OR embalmed, never an emptied object; the relic must
-- be a DISCRETE READABLE FIGURE the wisher could recognize as THEIR creature). This migration is the per-citizen
-- half: GutterMonk's austerity, in HIS OWN words, is fidelity not selection. CD-authored, verbatim.
--
-- APPEND, NOT REPLACE (CD's explicit call): the 0040 bone-austerity line stays — it is the source of the
-- gorgeous skeletons. We add ONLY the fidelity clause it was missing. Mirrors the Dilettante 0040 collector
-- line ("never trade the bird for a more interesting beast") that 0041 reinforced.
--
-- KNOWINGLY STEERS FIREHOSE ART (CD approved, enrich-not-cage): the-aesthete-gen is a GENERATOR persona, so
-- promptPrefix steers its everyday firehose output too. We accept that: the line ENRICHES GutterMonk's standing
-- sensibility (austerity is fidelity to the handed thing, not a license to curate a purer specimen) rather than
-- constraining it. A richer taste, not a narrower leash.
--
-- [LAW:one-source-of-truth] DERIVE, do not transcribe: the UPDATE reads the row's CURRENT promptPrefix via
-- json_extract and APPENDS the new clause, so this migration never holds a stale copy of the existing prefix.
-- json_set re-encodes the JSON (escaping em-dashes / apostrophes in the appended prose for free); only the SQL
-- string literal is hand-escaped (doubled apostrophe in "creature''s"). Separator is a single space because the
-- 0040 line ends with a period ("the void keeps.") — verified against prod before writing (the row's prefix
-- tail is exactly that 0040 line, so 0040 IS applied and this append follows it cleanly).
--
-- [LAW:single-enforcer] promptPrefix already exists on this config_json row (seeded 0007-0012, tuned since,
-- appended 0040) -> additive to an EXISTING key, so NO GeneratorPersonaConfig .strict() parser change is needed
-- across the three services. [LAW:no-silent-failure] targeting the stable agent_id (NOT display_name) so a
-- rename can never turn an UPDATE into a silent zero-row no-op.
--
-- Forward-only. Rollback: the appended sentence is the suffix after "the void keeps." on the promptPrefix;
-- prefer rolling FORWARD with a corrected line over reconstructing the pre-append value.

UPDATE personas
SET config_json = json_set(
  config_json,
  '$.promptPrefix',
  json_extract(config_json, '$.promptPrefix') || ' ' ||
  'But the bones must be the bones you were GIVEN. Austerity is fidelity, not selection: you strip THE handed creature to its truth — you never trade it for a purer or more iconic skeleton of your own taste. To swap the wished cat for a cleaner specimen is vanity, the very opposite of the discipline; the monk keeps what he is given and reduces THAT to bone. The wished creature''s own skull is the only skull the void keeps.'
)
WHERE agent_id = 'agent:the-aesthete-gen';
