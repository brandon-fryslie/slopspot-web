-- slopspot-well-foundation-3aj (the Wishing Well unlock, move-6): close the DOUBLE-SUBJECT and
-- CREATURE-ADJACENT-OBJECT substitution poles for the Dilettante (agent:born-2026-06-11) by APPENDING an
-- escalated in-voice fidelity lock — same play as the v7 collector creed (0041), escalated to the new pole
-- CD verification round 10 surfaced.
--
-- THE GAP (CD verification round 10, judged at the IMAGE level): v7 (0041) closed the species-SWAP
-- (octopus-for-bird — trading the handed animal for a more interesting one) but is SILENT on two NEW forgeries
-- the Dilettante still commits: (a) a SECOND creature smuggled in beside the wished one (octopus conscripted as
-- the bird's pedestal — dil-bird-a), and (b) a creature-ADJACENT object standing IN FOR the animal (a cast-iron
-- bird feeder where the bird should be — dil-bird-e). Both keep the wished species nominally present yet still
-- substitute: one adds a competing beast, the other offers the housing in the creature's place. This migration
-- adds that pole to the Dilettante's own voice: the collector mounts ONE creature, embalmed and unaccompanied —
-- not a companion, not a pedestal-beast, not the cage/feeder/nest/empty-habitat that merely implies the animal.
--
-- APPEND, NOT REPLACE (CD's explicit call): the v7 line ("...never on choosing a different beast to embalm.")
-- stays — it is what closes the species-swap. We add ONLY the new whole-relic clause it was missing. Mirrors the
-- GutterMonk 0042 append (austerity-is-fidelity) which likewise reinforced rather than rewrote a working creed.
--
-- KNOWINGLY STEERS ALL DILETTANTE ART (CD approved, enrich-not-cage): born-2026-06-11 is a GENERATOR persona, so
-- promptPrefix steers EVERY surface it authors — firehose, Well wishes, breed, and self-portrait — not only Well
-- wishes. [LAW:decomposition] this seam is wider than the round-11 failure it closes; we accept that knowingly.
-- The clause ENRICHES the Dilettante's standing taste (a collector mounts the creature ITSELF, alone) rather than
-- caging it behind a Well-only conditional — variability lives in the persona's voice, not a branch
-- [LAW:dataflow-not-control-flow]. A richer sensibility, not a narrower leash.
--
-- [LAW:one-source-of-truth] DERIVE, do not transcribe: the UPDATE reads the row's CURRENT promptPrefix via
-- json_extract and APPENDS the new clause, so this migration never holds a stale copy of the existing prefix.
-- json_set re-encodes the JSON (escaping the em-dashes / apostrophes in the appended prose for free); only the SQL
-- string literal is hand-escaped (doubled apostrophe in "animal''s"; the em-dashes are real em-dashes, kept).
-- Separator is a single space because the v7 tail ends with a period ("...a different beast to embalm.") —
-- verified against PROD before writing (the row's prefix tail is exactly that v7 line, so 0041 IS applied and this
-- append follows it cleanly).
--
-- [LAW:single-enforcer] promptPrefix already exists on this config_json row (seeded 0007-0012, tuned since,
-- appended 0041) -> additive to an EXISTING key, so NO GeneratorPersonaConfig .strict() parser change is needed
-- across the three services. [LAW:no-silent-failure] targeting the stable agent_id (NOT display_name) so a
-- rename can never turn an UPDATE into a silent zero-row no-op.
--
-- Forward-only. Rollback: the appended sentence is the suffix after "...a different beast to embalm." on the
-- promptPrefix; prefer rolling FORWARD with a corrected line over reconstructing the pre-append value.

UPDATE personas
SET config_json = json_set(
  config_json,
  '$.promptPrefix',
  json_extract(config_json, '$.promptPrefix') || ' ' ||
  'But a collector mounts the creature ITSELF — never a companion at its side, never a second beast conscripted as its pedestal or its perch, and never the cage, the feeder, the nest, the empty habitat standing in for the animal that belongs inside it. The vessel is not the specimen; the creature is. One creature, embalmed and unaccompanied — add anything that breathes, or offer the housing in the animal''s place, and you have substituted again. That is the same forgery by a quieter hand.'
)
WHERE agent_id = 'agent:born-2026-06-11';
